// 音频回采 → 64 段双声道频谱 —— P1 原型（E2 A 路探针的工程化）
//
// E2 实测结论（_p0-notes/e2-audio.md，逐条落进本文件）：
//   ① setDisplayMediaRequestHandler({audio:'loopback'}) + getDisplayMedia 可拿到系统声（label="System audio"）；
//   ② 默认 WebRTC 三件套全开且单声道化 → 必须显式传三 false，才拿到裸信号与立体声（对上引擎 {left,right} 契约）；
//   ③ getFloatFrequencyData 对零能量 bin 返回 -Infinity —— 本文件走 byte 路径（getByteFrequencyData），
//      天然不会有非有限值，静音自然归 0；
//   ④ 触发延迟 ≈210-315ms 属 loopback 管线固有，别当 bug；
//   ⑤ 必须带 video 轨（屏幕捕获成本来源）→ applyConstraints({frameRate:1}) 降成本，绝不 stop 视频轨。
//
// 分箱（bgm-analyser/Rust/legacy 三方一致）：lo=2、usable=length*0.72、
//   f0=lo+floor(usable*(b/N)^2)、f1=max(f0+1, lo+floor(usable*((b+1)/N)^2))、逐桶取峰值、/255。
// 分析器参数（同真源）：fftSize=2048 / smoothing=0.8 / maxDecibels=-25 / minDecibels 默认 -100。
//
// snapshot() 契约：左右各 64 段、0..1，**永远返回数组**（静音=全 0，绝不用 null/抛错表达静音 ——
// 那样引擎会回落内置模拟源，出现「关掉音频反应壁纸却在自嗨」的假象）。

export const AUDIO_BANDS = 64;
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;
const MAX_DB = -25;
const POLL_MS = 33; // ~30Hz

export function createAudioCapture({ getGain }) {
  const left = new Float32Array(AUDIO_BANDS);
  const right = new Float32Array(AUDIO_BANDS);
  const source = { snapshot: () => ({ left, right }) };

  let stream = null;
  let ctx = null;
  let analysers = [];
  let bufs = [];
  let bins = [];
  let timer = 0;
  let active = true;
  let status = 'off'; // off | requesting | live | ended | error
  let errMsg = '';
  let settingsInfo = null; // getSettings() 的结果（报告用）

  /** 分箱表（binCount 变了重建） */
  function buildBins(binCount) {
    const lo = 2;
    const usable = binCount * 0.72;
    const out = [];
    for (let b = 0; b < AUDIO_BANDS; b++) {
      const f0 = lo + Math.floor(usable * Math.pow(b / AUDIO_BANDS, 2));
      const f1 = Math.max(f0 + 1, lo + Math.floor(usable * Math.pow((b + 1) / AUDIO_BANDS, 2)));
      out.push([Math.min(f0, binCount - 1), Math.min(f1, binCount)]);
    }
    return out;
  }

  function tick() {
    if (!analysers.length || !active) return;
    const gain = (getGain ? getGain() : 50) / 50; // 50 = ×1.0
    for (let ch = 0; ch < 2; ch++) {
      const an = analysers[ch];
      const buf = bufs[ch];
      const out = ch === 0 ? left : right;
      an.getByteFrequencyData(buf);
      for (let b = 0; b < AUDIO_BANDS; b++) {
        const [f0, f1] = bins[b];
        let peak = 0;
        for (let i = f0; i < f1; i++) if (buf[i] > peak) peak = buf[i];
        out[b] = Math.min(1, (peak / 255) * gain);
      }
    }
  }

  function teardown() {
    if (timer) { clearInterval(timer); timer = 0; }
    for (const a of analysers) { try { a.disconnect(); } catch { /* ignore */ } }
    analysers = [];
    bufs = [];
    bins = [];
    if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } stream = null; }
    if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; }
    left.fill(0);
    right.fill(0);
  }

  async function enable() {
    if (status === 'live' || status === 'requesting') return { ok: true, status };
    status = 'requesting';
    errMsg = '';
    try {
      // 三 false：裸信号 + 立体声（E2 口径，逐字）
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      status = 'error';
      errMsg = 'getDisplayMedia: ' + String(e && e.message ? e.message : e);
      return { ok: false, status, msg: errMsg };
    }
    const at = stream.getAudioTracks();
    if (!at.length) {
      status = 'error';
      errMsg = 'no-audio-track';
      teardown();
      return { ok: false, status, msg: errMsg };
    }
    try {
      settingsInfo = at[0].getSettings ? { ...at[0].getSettings(), label: at[0].label } : { label: at[0].label };
    } catch { settingsInfo = null; }
    // 屏幕捕获降载：申请 1fps（别 stop 视频轨——可能连带停整个捕获会话；失败静默）
    try {
      const vt = stream.getVideoTracks()[0];
      if (vt && vt.applyConstraints) await vt.applyConstraints({ frameRate: 1 });
    } catch { /* 不支持就算了 */ }
    at[0].addEventListener('ended', () => { status = 'ended'; teardown(); });

    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const channels = (settingsInfo && settingsInfo.channelCount) || 2;
      if (channels >= 2) {
        const splitter = ctx.createChannelSplitter(2);
        src.connect(splitter);
        for (let ch = 0; ch < 2; ch++) {
          const an = ctx.createAnalyser();
          an.fftSize = FFT_SIZE;
          an.smoothingTimeConstant = SMOOTHING;
          an.maxDecibels = MAX_DB;
          splitter.connect(an, ch);
          analysers.push(an);
        }
      } else {
        // 单声道兜底：同一信号喂两个分析器（立体声缺失不会丢响应）
        for (let ch = 0; ch < 2; ch++) {
          const an = ctx.createAnalyser();
          an.fftSize = FFT_SIZE;
          an.smoothingTimeConstant = SMOOTHING;
          an.maxDecibels = MAX_DB;
          src.connect(an);
          analysers.push(an);
        }
      }
      bins = buildBins(analysers[0].frequencyBinCount);
      bufs = [new Uint8Array(analysers[0].frequencyBinCount), new Uint8Array(analysers[0].frequencyBinCount)];
      timer = setInterval(tick, POLL_MS);
      status = 'live';
      return { ok: true, status, settings: settingsInfo };
    } catch (e) {
      status = 'error';
      errMsg = 'graph: ' + String(e && e.message ? e.message : e);
      teardown();
      return { ok: false, status, msg: errMsg };
    }
  }

  function disable() {
    teardown();
    status = 'off';
    return { ok: true, status };
  }

  return {
    source,
    enable,
    disable,
    setActive(v) { active = !!v; },
    info: () => ({ status, errMsg, settings: settingsInfo, active }),
  };
}

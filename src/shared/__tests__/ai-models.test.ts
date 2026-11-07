/**
 * 动态模型清单的纯函数（v23）。
 *
 * 这些函数的输出会直接变成设置页下拉框里的字和真正发出去的 model id，
 * 所以两层都要钉住：
 *   · 显示名必须是人话，且**永远不丢真 id**（下拉框的 value 是 id）；
 *   · 解析失败必须返回 null，让上层如实说「拿不到清单」，绝不能返回空数组
 *     冒充「这台 Key 一个模型都没有」。
 */
import { describe, expect, it } from 'vitest'
import {
  modelsUrlCandidates,
  parseAiModelList,
  prettyAiModelName
} from '../ai-models'

describe('modelsUrlCandidates', () => {
  it('官方厂商：地址 + /models，尾斜杠先剥掉', () => {
    expect(modelsUrlCandidates('deepseek', 'https://api.deepseek.com')).toEqual([
      'https://api.deepseek.com/models'
    ])
    expect(modelsUrlCandidates('openai', 'https://api.openai.com/v1/')).toEqual([
      'https://api.openai.com/v1/models'
    ])
    expect(modelsUrlCandidates('anthropic', 'https://api.anthropic.com/v1')).toEqual([
      'https://api.anthropic.com/v1/models'
    ])
  })

  it('用户把整条 chat/completions 粘进来自定义地址：先剥再拼', () => {
    expect(
      modelsUrlCandidates('custom', 'https://gw.example.com/v1/chat/completions')
    ).toEqual([
      'https://gw.example.com/v1/models',
      'https://gw.example.com/models'
    ])
  })

  it('自定义网关：/v1 结尾时两个候选（自身 + 根），否则两个（自身 + /v1）', () => {
    expect(modelsUrlCandidates('custom', 'https://gw.example.com')).toEqual([
      'https://gw.example.com/models',
      'https://gw.example.com/v1/models'
    ])
    expect(modelsUrlCandidates('custom', 'https://gw.example.com/v1')).toEqual([
      'https://gw.example.com/v1/models',
      'https://gw.example.com/models'
    ])
  })

  it('地址本身已经以 /models 结尾：只发这一次，不叠加', () => {
    expect(modelsUrlCandidates('custom', 'https://gw.example.com/v1/models')).toEqual([
      'https://gw.example.com/v1/models'
    ])
  })

  it('空地址没有候选（调用方据此返回 offline，而不是拼出一个 /models）', () => {
    expect(modelsUrlCandidates('custom', '   ')).toEqual([])
  })

  it('2026-11-01 新增的五家：各自地址 + /models', () => {
    expect(modelsUrlCandidates('zhipu', 'https://open.bigmodel.cn/api/paas/v4')).toEqual([
      'https://open.bigmodel.cn/api/paas/v4/models'
    ])
    expect(modelsUrlCandidates('xai', 'https://api.x.ai/v1')).toEqual([
      'https://api.x.ai/v1/models'
    ])
    expect(modelsUrlCandidates('baidu', 'https://qianfan.baidubce.com/v2')).toEqual([
      'https://qianfan.baidubce.com/v2/models'
    ])
    expect(modelsUrlCandidates('hunyuan', 'https://tokenhub.tencentmaas.com/v1')).toEqual([
      'https://tokenhub.tencentmaas.com/v1/models'
    ])
  })

  it('Gemini：先试 OpenAI 兼容层，再退到原生 /v1beta/models', () => {
    expect(
      modelsUrlCandidates('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/')
    ).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'
    ])
  })

  it('Gemini 的兜底只在官方地址上出现 —— 别的地址绝不带 Google Key 去试', () => {
    expect(modelsUrlCandidates('gemini', 'https://gw.example.com/v1beta/openai')).toEqual([
      'https://gw.example.com/v1beta/openai/models'
    ])
  })
})

describe('prettyAiModelName', () => {
  it('主人点名的几个易读名', () => {
    expect(prettyAiModelName('deepseek', 'deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash')
    expect(prettyAiModelName('deepseek', 'deepseek-v4-pro')).toBe('DeepSeek V4 Pro')
    expect(prettyAiModelName('qwen', 'qwen3-max')).toBe('Qwen3 Max')
    expect(prettyAiModelName('pool', 'kilo-auto/free')).toBe('Auto Free')
  })

  it('新五家的常用模型也是人话', () => {
    expect(prettyAiModelName('zhipu', 'glm-4.7-flash')).toBe('GLM-4.7 Flash')
    expect(prettyAiModelName('zhipu', 'glm-4.6')).toBe('GLM-4.6')
    expect(prettyAiModelName('zhipu', 'glm-4-plus')).toBe('GLM-4 Plus')
    expect(prettyAiModelName('zhipu', 'glm-4-flash')).toBe('GLM-4 Flash')
    expect(prettyAiModelName('xai', 'grok-beta')).toBe('Grok Beta')
    expect(prettyAiModelName('xai', 'grok-4.3')).toBe('Grok 4.3')
    expect(prettyAiModelName('gemini', 'gemini-1.5-pro')).toBe('Gemini 1.5 Pro')
    expect(prettyAiModelName('gemini', 'gemini-2.5-flash')).toBe('Gemini 2.5 Flash')
    expect(prettyAiModelName('baidu', 'ernie-4.0-8k')).toBe('ERNIE 4.0 8K')
    expect(prettyAiModelName('baidu', 'ernie-5.1')).toBe('ERNIE 5.1')
    expect(prettyAiModelName('hunyuan', 'hunyuan-standard')).toBe('Hunyuan Standard')
    expect(prettyAiModelName('hunyuan', 'hy3')).toBe('Hunyuan Hy3')
    expect(prettyAiModelName('hunyuan', 'hy4-preview')).toBe('Hunyuan Hy4 Preview')
  })

  it('未知型号也能拆成人话：品牌大小写、版本分段、70b/8k 不拆', () => {
    // 融合写法会被拆成「品牌 + 版本 + 档位」三段；真实接口返回的是带连字符的
    // `qwen3-max`，走上面的已知名。两种写法都可读，不为此再加一条分支。
    expect(prettyAiModelName('custom', 'qwen3max')).toBe('Qwen 3 Max')
    expect(prettyAiModelName('custom', 'deepseekv5pro')).toBe('DeepSeek V5 Pro')
    expect(prettyAiModelName('custom', 'llama-3-70b')).toBe('Llama 3 70B')
    expect(prettyAiModelName('custom', 'some-8k-model')).toBe('Some 8K Model')
    expect(prettyAiModelName('openai', 'gpt-4o')).toBe('GPT-4o')
  })

  it('厂商给的 display_name 是人话就直接用（带空格或汉字）', () => {
    expect(prettyAiModelName('pool', 'free/x', 'X 模型')).toBe('X 模型')
    expect(prettyAiModelName('pool', 'free/x', 'X Model')).toBe('X Model')
  })

  it('display_name 与 id 相同/是机器名时不照抄，仍走美化', () => {
    expect(prettyAiModelName('pool', 'free/a-model', 'free/a-model')).toBe('A Model')
  })

  it('单字母名字（如 free/a 的末段 a）不拿来当标签 —— 那是坏标签，不是名字', () => {
    expect(prettyAiModelName('pool', 'free/a')).toBe('free/a')
  })
})

describe('parseAiModelList', () => {
  it('{data:[...]}：id 去空白、去重、display_name 优先', () => {
    const out = parseAiModelList(
      JSON.stringify({
        data: [
          { id: 'b-model', display_name: 'B 模型' },
          { id: ' a-model ' },
          { id: 'a-model', name: '重复的' }
        ]
      }),
      'custom'
    )
    expect(out).not.toBeNull()
    expect(out?.map((m) => m.id)).toEqual(['a-model', 'b-model'])
    expect(out?.find((m) => m.id === 'b-model')?.name).toBe('B 模型')
    expect(out?.find((m) => m.id === 'a-model')?.name).toBe('A Model')
  })

  it('兼容 {models:[]}、{data:{models:[]}}、{result:[]} 与裸数组', () => {
    const shapes = [
      { models: [{ id: 'm1' }] },
      { data: { models: [{ id: 'm1' }] } },
      { result: [{ id: 'm1' }] },
      [{ id: 'm1' }]
    ]
    for (const body of shapes) {
      const out = parseAiModelList(JSON.stringify(body), 'custom')
      expect(out?.map((m) => m.id), JSON.stringify(body)).toEqual(['m1'])
    }
  })

  it('有的网关把 id 叫 model：照样收', () => {
    const out = parseAiModelList(JSON.stringify([{ model: 'gateway-model' }]), 'custom')
    expect(out).toEqual([{ id: 'gateway-model', name: 'Gateway Model' }])
  })

  it('Gemini 原生清单：id 在 name 里、带 models/ 前缀，发请求前必须剥掉', () => {
    const out = parseAiModelList(
      JSON.stringify({
        models: [
          { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
          { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
          { name: 'models/text-embedding-004', displayName: 'Text Embedding 004' }
        ]
      }),
      'gemini'
    )
    expect(out).not.toBeNull()
    expect(out?.map((m) => m.id)).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro'])
    expect(out?.map((m) => m.name)).toEqual(['Gemini 1.5 Flash', 'Gemini 1.5 Pro'])
  })

  it('Gemini 兼容层若已经给的是裸 id，也照样收（不重复剥前缀）', () => {
    const out = parseAiModelList(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-1.5-pro' }, { id: 'gemini-1.5-flash' }]
      }),
      'gemini'
    )
    expect(out?.map((m) => m.id)).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro'])
  })

  it('畸形 JSON / 不是清单 / 全是坏行 → null（不是空数组）', () => {
    expect(parseAiModelList('not json', 'custom')).toBeNull()
    expect(parseAiModelList('{"error":{"message":"bad key"}}', 'custom')).toBeNull()
    expect(parseAiModelList('{"data":[]}', 'custom')).toBeNull()
    expect(parseAiModelList('{"data":[{"id":""},{"id":42},null]}', 'custom')).toBeNull()
  })

  it('非对话端点（embedding/tts/whisper）被筛掉；认不出来时全留', () => {
    const out = parseAiModelList(
      JSON.stringify({
        data: [
          { id: 'chat-pro' },
          { id: 'text-embedding-3-large' },
          { id: 'tts-1' },
          { id: 'whisper-1' }
        ]
      }),
      'openai'
    )
    expect(out?.map((m) => m.id)).toEqual(['chat-pro'])

    const unknown = parseAiModelList(
      JSON.stringify([{ id: 'internal-a' }, { id: 'internal-b' }]),
      'custom'
    )
    expect(unknown?.map((m) => m.id)).toEqual(['internal-a', 'internal-b'])
  })

  it('常用模型排前面（目录顺序），其余的按名字排 —— 两次拉取顺序稳定', () => {
    const out = parseAiModelList(
      JSON.stringify({ data: [{ id: 'z-model' }, { id: 'gpt-4o-mini' }, { id: 'a-model' }] }),
      'openai'
    )
    expect(out?.map((m) => m.id)).toEqual(['gpt-4o-mini', 'a-model', 'z-model'])
  })

  it('两个 id 美化后同名：追加真 id 区分，value 永远还是 id', () => {
    const out = parseAiModelList(
      JSON.stringify({ data: [{ id: 'vendor-a/same' }, { id: 'vendor-b/same' }] }),
      'custom'
    )
    expect(out?.map((m) => m.name)).toEqual([
      'Same (vendor-a/same)',
      'Same (vendor-b/same)'
    ])
    expect(out?.map((m) => m.id)).toEqual(['vendor-a/same', 'vendor-b/same'])
  })

  it('腾讯混元：TokenHub 的清单是全平台的，只留 hy*/hunyuan* 且只留 online', () => {
    const out = parseAiModelList(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'hy3', name: 'Hy3', status: 'online' },
          { id: 'hy4-preview', name: 'Hy4 Preview', status: 'online' },
          { id: 'hy-role', name: 'Hy Role', status: 'online' },
          { id: 'hy-mt2-pro', name: 'Hy MT2 Pro', status: 'pre-offline' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', status: 'online' },
          { id: 'glm-4.7', name: 'GLM-4.7', status: 'online' }
        ]
      }),
      'hunyuan'
    )
    expect(out?.map((m) => m.id)).toEqual(['hy3', 'hy4-preview', 'hy-role'])
    // 厂商给的 display name（Hy4 Preview）是给人看的，照用；hy3 没有 display
    // name 时走已知名。
    expect(out?.map((m) => m.name)).toEqual(['Hunyuan Hy3', 'Hy4 Preview', 'Hy Role'])
  })

  it('百度千帆：只留 type=chat、未下线、且 id 是 ERNIE 的行', () => {
    const out = parseAiModelList(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'ernie-5.1', type: 'chat', status: 'active' },
          { id: 'ernie-4.0-8k', type: 'chat', status: 'offline' },
          { id: 'deepseek-v3.2', type: 'chat', status: 'active' },
          { id: 'ernie-embedding-v1', type: 'embeddings', status: 'active' }
        ]
      }),
      'baidu'
    )
    expect(out?.map((m) => m.id)).toEqual(['ernie-5.1'])
  })

  it('xAI：grok-imagine-* 是画图/视频模型，不进对话下拉框', () => {
    const out = parseAiModelList(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'grok-4.3' },
          { id: 'grok-4.7' },
          { id: 'grok-imagine-image-pro' },
          { id: 'grok-imagine-video' }
        ]
      }),
      'xai'
    )
    expect(out?.map((m) => m.id)).toEqual(['grok-4.3', 'grok-4.7'])
  })

  it('Gemini 原生清单：supportedGenerationMethods 不含 generateContent 的一律不要', () => {
    const out = parseAiModelList(
      JSON.stringify({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent', 'countTokens']
          },
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent']
          },
          {
            name: 'models/gemini-2.5-pro',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      }),
      'gemini'
    )
    expect(out?.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('智谱：cogview/cogvideo 是画图/视频模型，不进对话下拉框', () => {
    const out = parseAiModelList(
      JSON.stringify({
        data: [
          { id: 'glm-4.7-flash' },
          { id: 'cogview-4' },
          { id: 'cogvideo-x' },
          { id: 'embedding-3' }
        ]
      }),
      'zhipu'
    )
    expect(out?.map((m) => m.id)).toEqual(['glm-4.7-flash'])
  })

  it('厂商过滤把清单清空时退回原始行：空下拉框比不完美的清单更糟', () => {
    // 例如 TokenHub 的 Key 只被授权了别家模型。那些模型确实能用，
    // 如实列出来 > 显示「无法获取模型列表」把一次可用的配置说成故障。
    const out = parseAiModelList(
      JSON.stringify({ data: [{ id: 'deepseek-v4-pro' }] }),
      'hunyuan'
    )
    expect(out?.map((m) => m.id)).toEqual(['deepseek-v4-pro'])
  })
})

#!/usr/bin/env node
/**
 * selfcheck.mjs —— S7 部署件自检（纯 node、零依赖；任意目录可跑：node server/deploy/selfcheck.mjs）。
 *
 * 【声明】compose.yml 的检查是**文本级结构检查**（tab / 缩进一致性 / 顶层键 / 按缩进切服务块 /
 * 关键字断言），**不是真 YAML 解析器**；本机没有 docker ⇒ 一切「能不能跑起来」都不在本脚本的
 * 证明范围里（`docker compose config`、`docker build`、真起容器都要在部署窗口的服务器上做）。
 *
 * 判据来源 = 服务器线已实测的事实：
 *   - HOST 默认 127.0.0.1（src/config.ts:125）⇒ compose 必须注入 0.0.0.0；
 *   - 迁移 runner 产物 = dist/db/migrate.js（tsconfig.build.json rootDir=src）；
 *   - 健康端点 = GET /v1/health（存活语义；旧文档里的旧端点名已作废，产物中零出现）；
 *   - node:24-bookworm-slim 无 curl/wget ⇒ 容器健康探针只能 node -e fetch；
 *   - 双角色先建后迁移（守卫式 GRANT）；api/db 不发布宿主端口。
 *
 * 末尾附带「尺子自检」：用合成的损坏样本证明对应判据红得出来（种坏见红纪律）。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(deployDir, '..');

const ARTIFACTS = {
  dockerfile: path.join(serverDir, 'Dockerfile'),
  dockerignore: path.join(serverDir, '.dockerignore'),
  compose: path.join(deployDir, 'compose.yml'),
  deploySh: path.join(deployDir, 'deploy.sh'),
  backupSh: path.join(deployDir, 'backup.sh'),
  healthSh: path.join(deployDir, 'healthcheck.sh'),
  rolesSql: path.join(deployDir, 'roles.sql'),
  readme: path.join(deployDir, 'README.md'),
  caddyfile: path.join(deployDir, 'Caddyfile'),
};

function loadArtifacts(overrides = {}) {
  const files = {};
  const missing = [];
  for (const [key, filePath] of Object.entries(ARTIFACTS)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      files[key] = overrides[key];
      continue;
    }
    try {
      files[key] = readFileSync(filePath, 'utf8');
    } catch {
      files[key] = '';
      missing.push(filePath);
    }
  }
  files.__missing = missing;
  return files;
}

const FILES_REAL = loadArtifacts();

// ── 工具 ─────────────────────────────────────────────────────────────────────
const has = (text, needle) => typeof text === 'string' && text.includes(needle);

/** 按缩进切 compose 的 services 块（文本级，够用即可；不是解析器） */
function parseCompose(text) {
  const services = new Map();
  let inServices = false;
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      current = null;
      continue;
    }
    if (inServices && /^[A-Za-z_]/.test(line)) {
      inServices = false;
      current = null;
      continue;
    }
    if (!inServices) continue;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      services.set(current, []);
      continue;
    }
    if (current !== null && line.trim() !== '') services.get(current).push(line);
  }
  const blocks = new Map();
  for (const [name, lines] of services) blocks.set(name, lines.join('\n'));
  return blocks;
}

const nonCommentLines = (text) =>
  String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

/** 去掉行内注释后的“代码部分”（用于 curl/wget 这类负例，避免打到说明文字） */
const stripInlineComment = (line) => line.replace(/\s+#.*$/, '');

function checkAll(files) {
  const results = [];
  for (const { id, desc, fn } of checks) {
    let outcome;
    try {
      outcome = fn(files);
    } catch (err) {
      outcome = { ok: false, detail: `异常: ${err instanceof Error ? err.message : String(err)}` };
    }
    results.push({ id, desc, ok: Boolean(outcome.ok), detail: outcome.detail ?? '' });
  }
  return results;
}

function bashSyntaxCheck() {
  const scripts = ['deploy.sh', 'backup.sh', 'healthcheck.sh'].map((n) => [n, path.join(deployDir, n)]);
  const bad = [];
  for (const [name, p] of scripts) {
    const r = spawnSync('bash', ['-n', p], { encoding: 'utf8' });
    if (r.error) return { ok: false, detail: `bash 不可用（${r.error.code ?? r.error.message}）——本机无 bash 时本判据无法成立` };
    if (r.status !== 0) bad.push(`${name}: ${(r.stderr || '').trim()}`);
  }
  return { ok: bad.length === 0, detail: bad.join(' | ') };
}

// ── 判据表 ───────────────────────────────────────────────────────────────────
const checks = [];
const check = (id, desc, fn) => checks.push({ id, desc, fn });

// A. 文件在位
check('A0', '九个产物文件全部存在可读', (F) => ({
  ok: F.__missing.length === 0,
  detail: F.__missing.length ? `缺：${F.__missing.join(', ')}` : '9/9',
}));

// D. Dockerfile
check('D1', 'Dockerfile 恰两阶段、FROM 均为 node:24-bookworm-slim', (F) => {
  const froms = String(F.dockerfile)
    .split(/\r?\n/)
    .filter((l) => /^FROM\s/.test(l));
  const bad = froms.filter((l) => !l.includes('node:24-bookworm-slim'));
  return { ok: froms.length === 2 && bad.length === 0, detail: `FROM 行=${froms.length}；不合规=${bad.length}` };
});
check('D2', '镜像基【已定稿】注释在（bookworm-slim）；负例：无【待主人拍板】残留', (F) => ({
  ok:
    has(F.dockerfile, '【已定稿】镜像基：bookworm-slim') &&
    has(F.dockerfile, 'alpine 字眼作废') &&
    !has(F.dockerfile, '【待主人拍板】'),
  detail: '',
}));
check('D3', 'npm ci 两次都走 npmmirror；运行层恰一次带 --omit=dev', (F) => {
  const cis = nonCommentLines(F.dockerfile).filter((l) => /^RUN npm ci\b/.test(l));
  const noMirror = cis.filter((l) => !l.includes('--registry=https://registry.npmmirror.com'));
  const omit = cis.filter((l) => l.includes('--omit=dev'));
  return {
    ok: cis.length === 2 && noMirror.length === 0 && omit.length === 1,
    detail: `RUN npm ci 行=${cis.length}；缺镜像源=${noMirror.length}；--omit=dev 行=${omit.length}`,
  };
});
check('D4', 'build 阶段执行 npm run build', (F) => ({ ok: has(F.dockerfile, 'RUN npm run build'), detail: '' }));
check('D5', 'COPY --from=build /app/dist ./dist', (F) => ({
  ok: has(F.dockerfile, 'COPY --from=build /app/dist ./dist'),
  detail: '',
}));
check('D6', 'COPY migrations ./migrations（迁移 runner 的相对路径锚点）', (F) => ({
  ok: has(F.dockerfile, 'COPY migrations ./migrations'),
  detail: '',
}));
check('D7', '运行层 ENV NODE_ENV=production', (F) => ({ ok: has(F.dockerfile, 'ENV NODE_ENV=production'), detail: '' }));
check('D8', 'USER node 非 root 运行 + node:24 与 argon2 的注释', (F) => ({
  ok: has(F.dockerfile, 'USER node') && /argon2/i.test(F.dockerfile) && has(F.dockerfile, 'node:24'),
  detail: '',
}));
check('D9', 'EXPOSE 8787 + CMD ["node", "dist/server.js"]', (F) => ({
  ok: has(F.dockerfile, 'EXPOSE 8787') && has(F.dockerfile, 'CMD ["node", "dist/server.js"]'),
  detail: '',
}));
check('D10', '注释写明 HOST=0.0.0.0 由 compose 注入（127.0.0.1 默认的坑）', (F) => ({
  ok: has(F.dockerfile, 'HOST=0.0.0.0') && has(F.dockerfile, 'compose') && has(F.dockerfile, '127.0.0.1'),
  detail: '',
}));
check('D11', '负例：Dockerfile 代码行不装 curl/wget、不引用 dist/index.js', (F) => {
  const code = nonCommentLines(F.dockerfile);
  const bad = code.filter((l) => /curl|wget/.test(stripInlineComment(l)) || l.includes('dist/index.js'));
  return { ok: bad.length === 0, detail: bad.length ? bad.join(' | ') : '' };
});

// C. compose
check('C1', 'compose：name: miai + 三服务 caddy/api/db', (F) => {
  const blocks = parseCompose(F.compose);
  const names = [...blocks.keys()].sort().join(',');
  return { ok: has(F.compose, 'name: miai') && names === 'api,caddy,db', detail: `服务块=[${names}]` };
});
check('C2', 'db 块逐字关键行（postgres:18-alpine / 挂载点 / 调参 / pg_isready）', (F) => {
  const b = parseCompose(F.compose).get('db') ?? '';
  const needles = ['postgres:18-alpine', 'pgdata:/var/lib/postgresql', 'shared_buffers=256MB', 'max_connections=40', 'pg_isready -U miai -d miai'];
  const missing = needles.filter((n) => !has(b, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('C3', 'caddy 块逐字关键行（2.11.4 / 80+443 / ./conf 目录挂载 / caddy_data / caddy_config）', (F) => {
  const b = parseCompose(F.compose).get('caddy') ?? '';
  const needles = ['caddy:2.11.4', '"80:80"', '"443:443"', './conf:/etc/caddy:ro', 'caddy_data:/data', 'caddy_config:/config'];
  const missing = needles.filter((n) => !has(b, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('C4', 'api：image ${API_TAG} / build context / env_file / restart / depends_on(healthy)', (F) => {
  const b = parseCompose(F.compose).get('api') ?? '';
  const needles = [
    'image: miai-api:${API_TAG}',
    'context: ./releases/current/server',
    'env_file: .env',
    'restart: unless-stopped',
    'condition: service_healthy',
  ];
  const missing = needles.filter((n) => !has(b, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('C5', 'api 注入 NODE_ENV=production 与 HOST: "0.0.0.0"', (F) => {
  const b = parseCompose(F.compose).get('api') ?? '';
  const missing = ['NODE_ENV: production', 'HOST: "0.0.0.0"'].filter((n) => !has(b, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('C6', 'api 用 expose 8787（容器内端口 8787）', (F) => {
  const b = parseCompose(F.compose).get('api') ?? '';
  return { ok: has(b, 'expose:') && has(b, '"8787"'), detail: '' };
});
check('C7', '负例：ports: 只允许出现在 caddy 块（api/db 块 0 次）', (F) => {
  const blocks = parseCompose(F.compose);
  const offenders = ['api', 'db'].filter((s) => has(blocks.get(s) ?? '', 'ports:'));
  return {
    ok: offenders.length === 0 && has(blocks.get('caddy') ?? '', 'ports:'),
    detail: offenders.length ? `${offenders.join(',')} 块出现了 ports:` : '',
  };
});
check('C8', 'api healthcheck = node -e fetch http://127.0.0.1:8787/v1/health；负例：代码行不用 curl/wget', (F) => {
  const b = parseCompose(F.compose).get('api') ?? '';
  const okNeedles = ["fetch('http://127.0.0.1:8787/v1/health')", 'node', '-e'];
  const missing = okNeedles.filter((n) => !has(b, n));
  const bad = nonCommentLines(b).filter((l) => /curl|wget/.test(stripInlineComment(l)));
  return { ok: missing.length === 0 && bad.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : bad.join(' | ') };
});
check('C9', 'networks 段故意不写 ipam（空 default 节点=no-op 实证）；代码行负例：无 ipam/subnet/172.20', (F) => {
  const code = nonCommentLines(F.compose);
  const bad = code.filter((l) => /ipam|subnet/.test(l));
  const ok =
    /^networks:\s*$/m.test(F.compose) &&
    /^\s{2}default:\s*$/m.test(F.compose) &&
    has(F.compose, 'docker network inspect miai_default') &&
    !has(F.compose, '172.20.0.0/16') &&
    bad.length === 0;
  return { ok, detail: bad.length ? `代码行含 ${bad.join(' | ')}` : '' };
});
check('C10', '文件头：仓库副本声明 + 现场为准 + B2 冻结行', (F) => {
  const needles = ['本模板是仓库副本', '现场改动以 /opt/miai/compose.yml 为准', '【冻结】B2 证书续期观察达标前不得 up/重建 caddy'];
  const missing = needles.filter((n) => !has(F.compose, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('C11', '负例：compose 里 /healthz 零出现；/v1/health 出现在 api 块', (F) => {
  const b = parseCompose(F.compose).get('api') ?? '';
  return { ok: !has(F.compose, '/healthz') && has(b, '/v1/health'), detail: '' };
});
check('C12', 'Caddyfile 正式版：reverse_proxy 启用、占位 respond 零残留、B2 关键行逐字保留', (F) => {
  const t = F.caddyfile;
  const needles = [
    'reverse_proxy api:8787',
    'header_up X-Forwarded-For {remote_host}',
    'default_sni 203.0.113.10',
    'profile shortlived',
    'protocols h1 h2',
    'admin@example.com',
  ];
  const missing = needles.filter((n) => !has(t, n));
  const leftover = ['respond "miai tls test ok"', '# reverse_proxy'].filter((n) => has(t, n));
  return {
    ok: missing.length === 0 && leftover.length === 0,
    detail: missing.length ? `缺：${missing.join(', ')}` : leftover.length ? `残留：${leftover.join(', ')}` : '',
  };
});

// S. 三个脚本
check('S1', '三个脚本都有 set -euo pipefail', (F) => {
  const missing = [
    ['deploy.sh', F.deploySh],
    ['backup.sh', F.backupSh],
    ['healthcheck.sh', F.healthSh],
  ].filter(([, t]) => !has(t, 'set -euo pipefail')).map(([n]) => n);
  return { ok: missing.length === 0, detail: missing.join(', ') };
});
check('S2', 'deploy.sh 迁移走 dist/db/migrate.js（负例：无 dist/migrate.js）', (F) => ({
  ok:
    has(F.deploySh, 'docker compose run --rm api node dist/db/migrate.js') &&
    has(F.deploySh, 'dist/db/migrate.js') &&
    !has(F.deploySh, 'dist/migrate.js'),
  detail: '',
}));
check('S3', 'deploy.sh：预更新备份 + up -d api + 10 次探针 + ≥5 门槛', (F) => {
  const needles = ['backup.sh', 'docker compose up -d api', 'seq 1 10', '[ "$ok" -lt 5 ]'];
  const missing = needles.filter((n) => !has(F.deploySh, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('S4', 'deploy.sh：探针判据含响应体 "ok":true（防占位 200 假绿）', (F) => ({
  ok: has(F.deploySh, '"ok":true'),
  detail: '',
}));
check('S5', 'deploy.sh：失败回滚写回旧 API_TAG', (F) => ({
  ok: has(F.deploySh, 'OLD_TAG') && has(F.deploySh, 'API_TAG=$OLD_TAG'),
  detail: '',
}));
check('S6', 'deploy.sh：前置闸门拒跑（占位 respond / Caddyfile 缺）', (F) => {
  const needles = ['respond "miai tls test ok"', 'reverse_proxy api:8787', 'conf/Caddyfile'];
  const missing = needles.filter((n) => !has(F.deploySh, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('S7', 'deploy.sh：server/ 前缀自证 + 软链 ln -sfn "$SHA" releases/current（负例：releases/$SHA 形态）', (F) => ({
  ok:
    has(F.deploySh, 'releases/$SHA/server/package.json') &&
    has(F.deploySh, 'ln -sfn "$SHA" releases/current') &&
    !has(F.deploySh, 'ln -sfn "releases/$SHA"'),
  detail: '',
}));
check('S8', 'backup.sh：umask 077 + -Fc + gzip + 保留 14 份 + 00:17 注释', (F) => {
  const needles = ['umask 077', '-Fc', 'gzip -f', '-mtime +14', '00:17'];
  const missing = needles.filter((n) => !has(F.backupSh, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('S9', 'healthcheck.sh：/v1/health + 证书 48h + 磁盘 80 + 备份 26h + 非零退出；探针必须 --resolve 形态（负例：裸 127.0.0.1 URL）', (F) => {
  const needles = ['/v1/health', 'openssl', '-lt 48', '-gt 80', '26', 'exit "$FAILED"', '--resolve "${SERVER_IP_VALUE}:443:127.0.0.1"'];
  const missing = needles.filter((n) => !has(F.healthSh, n));
  // 2026-10-12 实测：Caddy 站点块按 Host 匹配（站点=IP 字面量），Host=127.0.0.1 的请求不进反代、
  // 被 fallback 以 200 空体接走（default_sni 只管 SNI）——裸写法必假红。此负例防它溜回来。
  const bareLoopback = has(F.healthSh, 'https://127.0.0.1/v1/health');
  const detail = [];
  if (missing.length) detail.push(`缺：${missing.join(', ')}`);
  if (bareLoopback) detail.push('出现裸 https://127.0.0.1/v1/health（Host 不匹配 Caddy 站点 ⇒ 不进反代）');
  return { ok: missing.length === 0 && !bareLoopback, detail: detail.join(' | ') };
});
check('S10', '三脚本 cron 时点注释（deploy 不进 cron / backup 00:17 / healthcheck 每 5 分钟）', (F) => ({
  ok: has(F.deploySh, 'cron') && has(F.backupSh, '00:17') && has(F.backupSh, '00:05') && has(F.healthSh, '*/5'),
  detail: '',
}));

// R. roles.sql
check('R1', 'roles.sql：双角色可登录、幂等创建（负例：无禁用登录的角色定义）', (F) => ({
  ok:
    has(F.rolesSql, 'CREATE ROLE miai_owner LOGIN PASSWORD') &&
    has(F.rolesSql, 'CREATE ROLE miai_app LOGIN PASSWORD') &&
    has(F.rolesSql, 'duplicate_object') &&
    !has(F.rolesSql, 'NOLOGIN'),
  detail: '',
}));
check('R2', 'roles.sql：GRANT CONNECT + miai_owner 的 CREATE/USAGE（含 grant option）', (F) => {
  const needles = [
    'GRANT CONNECT ON DATABASE miai TO miai_owner',
    'GRANT CONNECT ON DATABASE miai TO miai_app',
    'GRANT CREATE ON SCHEMA public TO miai_owner',
    'GRANT USAGE ON SCHEMA public TO miai_owner WITH GRANT OPTION',
  ];
  const missing = needles.filter((n) => !has(F.rolesSql, n));
  return { ok: missing.length === 0, detail: missing.length ? `缺：${missing.join(', ')}` : '' };
});
check('R3', 'roles.sql：先建角色→后跑迁移注释 + 点名可执行规格测试', (F) => ({
  ok: has(F.rolesSql, '先建角色 → 后跑迁移') && has(F.rolesSql, 'grants-real-pg.test.ts:40-56'),
  detail: '',
}));
check('R4', 'roles.sql：口令只允许 <现场生成> 占位（无任何疑似真口令）', (F) => {
  const bad = String(F.rolesSql)
    .split(/\r?\n/)
    .filter((l) => /PASSWORD/i.test(l) && !l.includes('<现场生成>'));
  return { ok: bad.length === 0, detail: bad.length ? bad.join(' | ') : '' };
});
check('R5', 'roles.sql：建完自证查询 roles_ready', (F) => ({
  ok: has(F.rolesSql, 'roles_ready'),
  detail: '',
}));

// W. README
check('W1', 'README：六步顺序 + 每步判据/回滚 关键词', (F) => ({
  ok: has(F.readme, '六步') && has(F.readme, '判据') && has(F.readme, '回滚'),
  detail: '',
}));
check('W2', 'README：cron 三条齐（00:05 / 00:17 / */5）', (F) => ({
  ok: has(F.readme, '00:05') && has(F.readme, '00:17') && has(F.readme, '*/5'),
  detail: '',
}));
check('W3', 'README：SERVER_IP / TRUST_PROXY_CIDR 现场补齐提示', (F) => ({
  ok: has(F.readme, 'SERVER_IP') && has(F.readme, 'TRUST_PROXY_CIDR'),
  detail: '',
}));
check('W4', 'README：与 /opt/miai 现场关系 + 先建角色红线 + 规格测试', (F) => ({
  ok: has(F.readme, '/opt/miai') && has(F.readme, '先建角色 → 后跑迁移') && has(F.readme, 'grants-real-pg.test.ts:40-56'),
  detail: '',
}));

// G. 全局负例
check('G1', '全局负例：/healthz 与 dist/migrate.js 在所有产物中零出现', (F) => {
  const offenders = [];
  for (const [key, text] of Object.entries(ARTIFACTS)) {
    if (has(F[key], '/healthz')) offenders.push(`${path.basename(text)}: /healthz`);
    if (has(F[key], 'dist/migrate.js')) offenders.push(`${path.basename(text)}: dist/migrate.js`);
  }
  return { ok: offenders.length === 0, detail: offenders.join(' | ') };
});
check('G2', '全局：无「键值对里的疑似真实口令」（口令只能是占位符/变量引用）', (F) => {
  const offenders = [];
  for (const [key, filePath] of Object.entries(ARTIFACTS)) {
    String(F[key])
      .split(/\r?\n/)
      .forEach((line, idx) => {
        if (/password\s*[:=]\s*["']?[A-Za-z0-9+/=]{8,}/i.test(line)) offenders.push(`${path.basename(filePath)}:${idx + 1}`);
      });
  }
  return { ok: offenders.length === 0, detail: offenders.join(' | ') };
});

// Y. compose 文本级结构（不是解析器）
check('Y1', 'compose 文本结构：无 tab、非空非注释行缩进为偶数', (F) => {
  const problems = [];
  String(F.compose)
    .split(/\r?\n/)
    .forEach((line, idx) => {
      if (line.trim() === '') return;
      if (line.includes('\t')) problems.push(`L${idx + 1} 含 tab`);
      const indent = (line.match(/^ */) || [''])[0].length;
      if (indent % 2 !== 0) problems.push(`L${idx + 1} 奇数缩进 ${indent}`);
    });
  return { ok: problems.length === 0, detail: problems.join(' | ') };
});
check('Y2', 'compose 文本结构：顶层键 name/services/volumes/networks 齐、且各一次', (F) => {
  const top = String(F.compose)
    .split(/\r?\n/)
    .filter((l) => /^[A-Za-z_]/.test(l))
    .map((l) => l.split(':')[0]);
  const want = ['name', 'services', 'volumes', 'networks'];
  const ok = want.every((k) => top.filter((t) => t === k).length === 1);
  return { ok, detail: `顶层键=[${top.join(',')}]` };
});

// B. bash 语法
check('B1', 'bash -n 语法检查（deploy.sh / backup.sh / healthcheck.sh）', () => bashSyntaxCheck());

// ── 跑真实文件 ───────────────────────────────────────────────────────────────
console.log('S7 部署件自检（selfcheck.mjs）');
console.log('声明：compose 检查为文本级结构检查，不是真 YAML 解析器；docker 行为不在本脚本证明范围（本机无 docker）。');
console.log('');
const realResults = checkAll(FILES_REAL);
for (const r of realResults) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.desc}${r.detail ? `  [${r.detail}]` : ''}`);
}
const failedReal = realResults.filter((r) => !r.ok);

// ── 尺子自检：合成损坏样本，对应判据必须变红 ─────────────────────────────────
console.log('');
console.log('[尺子自检] 用合成损坏样本验证判据不是恒绿：');
const mutations = [
  {
    desc: '删掉 api 的 HOST: "0.0.0.0" 行',
    expect: ['C5'],
    apply: (F) => ({ compose: F.compose.split(/\r?\n/).filter((l) => !/^\s*HOST: "0\.0\.0\.0"\s*$/.test(l)).join('\n') }),
  },
  {
    desc: '把 deploy.sh 的 dist/db/migrate.js 改回 dist/migrate.js',
    expect: ['S2'],
    apply: (F) => ({ deploySh: F.deploySh.split('dist/db/migrate.js').join('dist/migrate.js') }),
  },
  {
    desc: '删掉 Dockerfile 的 COPY migrations ./migrations',
    expect: ['D6'],
    apply: (F) => ({ dockerfile: F.dockerfile.split(/\r?\n/).filter((l) => l.trim() !== 'COPY migrations ./migrations').join('\n') }),
  },
  {
    desc: '给 api 块塞一段 ports: 8787',
    expect: ['C7'],
    apply: (F) => ({ compose: F.compose.replace('\n    expose:', '\n    ports:\n      - "8787:8787"\n    expose:') }),
  },
  {
    desc: '给 networks 段的 default 塞回 ipam 块',
    expect: ['C9'],
    apply: (F) => ({
      compose: F.compose.replace(/^(\s{2}default:)\s*$/m, '$1\n    ipam:\n      config:\n        - subnet: 172.18.0.0/16'),
    }),
  },
  {
    desc: '把 healthcheck.sh 探针从 --resolve 形态改回裸 https://127.0.0.1/v1/health',
    expect: ['S9'],
    apply: (F) => ({
      healthSh: F.healthSh.replace(
        /body=\$\(curl -fsS --max-time 5 -k --resolve "\$\{SERVER_IP_VALUE\}:443:127\.0\.0\.1" "https:\/\/\$\{SERVER_IP_VALUE\}\/v1\/health" 2>\/dev\/null \|\| true\)/,
        'body=$(curl -fsS --max-time 5 -k "https://127.0.0.1/v1/health" 2>/dev/null || true)',
      ),
    }),
  },
  {
    desc: '把 Caddyfile 换回占位 respond 版本',
    expect: ['C12'],
    apply: (F) => ({
      caddyfile: 'https://203.0.113.10 {\n\trespond "miai tls test ok" 200\n}\n',
    }),
  },
];
let selftestOk = true;
const realById = new Map(realResults.map((r) => [r.id, r]));
const realFailed = new Set(failedReal.map((r) => r.id));
for (const m of mutations) {
  const preconditionOk = m.expect.every((id) => realById.get(id)?.ok === true);
  const mutated = loadArtifacts(m.apply(FILES_REAL));
  const mutatedFailed = new Set(checkAll(mutated).filter((r) => !r.ok).map((r) => r.id));
  const wentRed = m.expect.every((id) => mutatedFailed.has(id));
  const ok = preconditionOk && wentRed;
  if (!ok) selftestOk = false;
  const newlyRed = [...mutatedFailed].filter((id) => !m.expect.includes(id) && !realFailed.has(id));
  console.log(
    `${ok ? 'SELFTEST-PASS' : 'SELFTEST-FAIL'} ${m.desc}：真实文件上 ${m.expect.join('/')} 绿=${preconditionOk}；损坏后 ${m.expect.join('/')} 红=${wentRed}` +
      (wentRed ? `（连带新变红：${newlyRed.join(',') || '无'}）` : ''),
  );
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────
console.log('');
console.log(`—— 汇总：${realResults.length - failedReal.length} PASS / ${failedReal.length} FAIL；尺子自检 ${selftestOk ? 'PASS' : 'FAIL'} ——`);
console.log('退出码：0 = 全部判据过且尺子自检过；1 = 有 FAIL（日志为准）。');
process.exitCode = failedReal.length === 0 && selftestOk ? 0 : 1;

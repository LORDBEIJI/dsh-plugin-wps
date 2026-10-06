#!/usr/bin/env node
/**
 * 安装「定制版 ppt-master」到 ~/.dsh/skills/ppt-master
 *
 * 做三件事：
 *   1. 从官方仓库拉取完整 ppt-master（若尚未安装）
 *   2. 用 overlay/ 下的定制文件覆盖官方版本
 *   3. 运行官方完整性门禁 attribution_guard.py 验证结果
 *
 * 为什么是「拉取 + 覆盖」而不是直接分发整个技能包：
 *   - ppt-master 是第三方作品（作者 Hugo He，MIT 许可），完整包约 13000 个文件 /
 *     80 MB。把它快照进本仓库会让 clone 变慢，而且永远停留在旧版本。
 *   - 本仓库只保存「定制差异」（overlay/），官方代码始终从上游获取，这样用户
 *     拿到的是最新官方功能 + 定制条款，同时你的仓库只增加几十 KB。
 *
 * 用法：
 *   node skill/ppt-master/install.mjs
 *   node skill/ppt-master/install.mjs --yes     # 跳过确认
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const UPSTREAM = 'https://github.com/hugohe3/ppt-master'
const AUTHOR = 'Hugo He'
const LICENSE = 'MIT'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = join(HERE, 'overlay')
const SKILL_DIR = join(homedir(), '.dsh', 'skills', 'ppt-master')

const OVERLAY_FILES = [
  ['SKILL.md', 'SKILL.md'],
  [join('workflows', 'routing.md'), join('workflows', 'routing.md')],
  ['LOCAL-CHANGES.md', 'LOCAL-CHANGES.md'],
]

const assumeYes = process.argv.includes('--yes')

function info(msg) {
  console.log(msg)
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

async function confirm(question) {
  if (assumeYes) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

/** 找一个能用的 Python 解释器（Windows 上 `python3` 往往是空壳）。 */
function findPython() {
  for (const candidate of ['python', 'python3', 'py']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // 试下一个
    }
  }
  return null
}

// ── 0. 署名前置说明 ───────────────────────────────────────────────
info('')
info('  定制版 ppt-master 安装器')
info('  ─────────────────────────────────────────────')
info(`  上游项目 : ${UPSTREAM}`)
info(`  作者     : ${AUTHOR}`)
info(`  许可     : ${LICENSE}`)
info('  本脚本分发的只是定制差异；官方代码始终从上游获取。')
info('')

// ── 1. 获取官方版本 ───────────────────────────────────────────────
const installed = existsSync(SKILL_DIR)
const isGitRepo = installed && existsSync(join(SKILL_DIR, '.git'))

if (!installed) {
  info(`→ 未检测到 ${SKILL_DIR}`)
  if (!(await confirm('  现在从上游克隆完整技能包（约 80 MB）？'))) {
    fail('已取消。技能包未安装。')
  }
  info('  正在克隆，可能需要几分钟…')
  execFileSync('git', ['clone', '--depth', '1', UPSTREAM, SKILL_DIR], { stdio: 'inherit' })
  info('  ✓ 官方版本已就绪')
} else if (isGitRepo) {
  info(`→ 检测到已安装的 git 仓库：${SKILL_DIR}`)
  if (await confirm('  先拉取上游最新版本再应用定制？')) {
    try {
      execFileSync('git', ['-C', SKILL_DIR, 'pull', '--ff-only'], { stdio: 'inherit' })
      info('  ✓ 已更新到上游最新')
    } catch {
      info('  ⚠ 拉取失败（可能是本地有未提交改动），继续使用当前版本')
    }
  } else {
    info('  跳过更新，使用当前版本')
  }
} else {
  info(`→ ${SKILL_DIR} 已存在，但它不是 git 仓库（可能是复制而来的副本）。`)
  info('  将继续在该目录上应用定制。')
  if (await confirm('  想要干净安装吗？（会删除该目录后重新克隆）')) {
    rmSync(SKILL_DIR, { recursive: true, force: true })
    execFileSync('git', ['clone', '--depth', '1', UPSTREAM, SKILL_DIR], { stdio: 'inherit' })
    info('  ✓ 已重新克隆')
  }
}

if (!existsSync(SKILL_DIR)) fail('技能目录不存在，安装中止。')

// ── 2. 应用定制 ───────────────────────────────────────────────────
info('')
info('→ 应用定制文件：')
for (const [from, to] of OVERLAY_FILES) {
  const src = join(OVERLAY, from)
  const dst = join(SKILL_DIR, to)
  if (!existsSync(src)) fail(`overlay 缺少文件：${from}`)
  cpSync(src, dst)
  info(`  ✓ ${to}`)
}
info('  定制内容：Pre-Flight Intake（先问确认方式与生成深度）、Cost Discipline（成本纪律）')

// ── 3. 运行官方完整性门禁 ─────────────────────────────────────────
info('')
info('→ 运行官方完整性门禁…')
const python = findPython()
if (!python) {
  info('  ⚠ 未找到 Python，跳过门禁校验。')
  info('    请自行确认 SKILL_DIR 下的 LICENSE / SPONSORS 文件完整。')
} else {
  const guard = join(SKILL_DIR, 'scripts', 'attribution_guard.py')
  if (!existsSync(guard)) {
    info('  ⚠ 未找到 scripts/attribution_guard.py，跳过校验。')
  } else {
    try {
      execFileSync(python, [guard], { stdio: 'inherit' })
      info('  ✓ 门禁通过 —— 定制没有破坏技能完整性')
    } catch {
      fail(
        '门禁未通过。这通常意味着 overlay 与当前上游版本不兼容。\n' +
          '  处理方式：删掉技能目录重新克隆，然后重新生成 overlay（见本地 LOCAL-CHANGES.md）。',
      )
    }
  }
}

// ── 完成 ─────────────────────────────────────────────────────────
info('')
info('  ✅ 安装完成')
info('  ─────────────────────────────────────────────')
info(`  技能位置 : ${SKILL_DIR}`)
info('  生效方式 : DSH 会热加载 ~/.dsh/skills 下的技能，无需重启。')
info('  如何使用 : 在 DSH 会话中说「用 ppt-master 做一个关于 X 的 PPT」。')
info('')
info('  提示：若 DSH 提示找不到该技能，请确认 include:skill-filesystem 插件已启用。')
info('')

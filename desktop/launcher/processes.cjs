/* Kill Process (shared/process-model.mjs): the running apps, read with `ps`, and Kill (SIGTERM, the same as asking it
   to quit) or Force Kill (SIGKILL) for one. The bar names an app by its path; every process signalled is found again
   in a fresh `ps`, so a made-up path or number kills nothing. `exec` and `kill` are passed in for the tests. */
function createProcesses({ exec, model, platform = process.platform, uid = process.getuid?.(), selfPid = process.pid, kill = process.kill.bind(process) }) {
  const list = async () => {
    if (platform !== 'darwin') return []
    return model.groupApps(await exec('/bin/ps', ['-axo', 'pid=,uid=,rss=,pcpu=,comm=']), { uid, selfPid })
  }
  return {
    list,
    /* → how many processes were signalled; 0 when that app isn't running any more. */
    async end(path, { force = false } = {}) {
      const group = (await list()).find((item) => item.path === path)
      if (!group) return 0
      let sent = 0
      for (const pid of group.pids) {
        try { kill(pid, force ? 'SIGKILL' : 'SIGTERM'); sent += 1 } catch { /* gone already */ }
      }
      return sent
    },
  }
}

module.exports = { createProcesses }

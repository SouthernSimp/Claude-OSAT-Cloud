/* Estimates run in a short-lived utility process, without loading model weights.
   The parent stays responsive and native allocations never enter the notes process. */
function estimateResources(fork, modelPath, timeout = 30000) {
  return new Promise((resolve) => {
    let child
    let finished = false
    let timer
    const finish = (value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child?.removeAllListeners()
      child?.kill()
      resolve(value)
    }
    try {
      child = fork()
      timer = setTimeout(() => finish(null), timeout)
      child.on('message', (message) => {
        if (message?.type === 'estimate') finish(message.estimate)
        else if (message?.type === 'error') finish(null)
      })
      child.on('exit', () => finish(null))
      child.postMessage({ type: 'estimate', modelPath })
    } catch { finish(null) }
  })
}
module.exports = { estimateResources }

/* Where is the caret, in pixels, inside a textarea? Browsers do not say, so
   we mirror the text into a hidden div with the same metrics and measure a
   marker placed at the caret. Standard trick; good enough for a popover. */

const COPIED = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize',
]

export function caretPosition(textarea, index = textarea.selectionEnd) {
  const mirror = document.createElement('div')
  const style = getComputedStyle(textarea)
  COPIED.forEach((property) => { mirror.style[property] = style[property] })
  Object.assign(mirror.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', whiteSpace: 'pre-wrap', overflow: 'hidden', height: 'auto' })
  mirror.textContent = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(index, index + 1) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const top = marker.offsetTop - textarea.scrollTop
  const left = marker.offsetLeft - textarea.scrollLeft
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5
  document.body.removeChild(mirror)
  return { top, left, lineHeight }
}

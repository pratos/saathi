export function prepareAssistantMarkdown(text: string, streaming = false) {
  let markdown = text
    .replace(/\s+(?=\d+\.\s+\*\*)/g, '\n\n')
    .replace(/\s+\*\s+\*\*(Rating|Address\/Area):\*\*\s*/gi, '\n   - **$1:** ')

  if (streaming) {
    const boldMarkers = markdown.match(/\*\*/g)?.length ?? 0
    if (boldMarkers % 2 === 1) {
      const unmatched = markdown.lastIndexOf('**')
      markdown = `${markdown.slice(0, unmatched)}${markdown.slice(unmatched + 2)}`
    }
    const codeMarkers = markdown.match(/`/g)?.length ?? 0
    if (codeMarkers % 2 === 1) {
      const unmatched = markdown.lastIndexOf('`')
      markdown = `${markdown.slice(0, unmatched)}${markdown.slice(unmatched + 1)}`
    }
  }

  return markdown
}

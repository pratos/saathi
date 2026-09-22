export const LATEST_MESSAGE_THRESHOLD_PX = 96

export function isNearLatestMessage({ scrollHeight, scrollTop, clientHeight }: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}) {
  return scrollHeight - scrollTop - clientHeight <= LATEST_MESSAGE_THRESHOLD_PX
}

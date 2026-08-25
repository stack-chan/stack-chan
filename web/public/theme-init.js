const theme = (() => {
  try {
    return localStorage.getItem('stackchan.theme') ?? 'system'
  } catch {
    return 'system'
  }
})()
const dark =
  theme === 'dark' ||
  (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
document.documentElement.style.colorScheme = dark ? 'dark' : 'light'

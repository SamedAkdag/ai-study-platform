/** Short transition cues — content lives in narrations, not here. */

export const LESSON_TRANSITIONS = {
  lessonOpen: (central: string) =>
    `Merhaba. Bugünkü dersimizin omurgası ${central}.`,
  /** After hub narration: invite the first main branch */
  branchesRoadmap: (titles: string[]) => {
    if (titles.length <= 1)
      return `${titles[0] || 'Ana başlık'} ile devam ediyoruz.`
    if (titles.length === 2)
      return `Önce ${titles[0]}, sonra ${titles[1]} gelecek.`
    return `Sırada ${titles[0]}, ${titles[1]} ve diğer ana başlıklar var.`
  },
  branchEnter: (title: string) => `Ana başlık: ${title}.`,
  /** Only before the first leaf under a branch */
  leavesIntro: (parentTitle: string) =>
    `${parentTitle} altındaki noktalara tek tek bakalım.`,
  leafEnter: (_parentTitle: string, _title: string) => '',
  branchClose: (title: string) => `${title} kısmını tamamladık.`,
  rootClose: (branchTitles: string[]) => {
    const list =
      branchTitles.length <= 1
        ? branchTitles[0] || 'ana konular'
        : branchTitles.length === 2
          ? `${branchTitles[0]} ve ${branchTitles[1]}`
          : `${branchTitles.slice(0, -1).join(', ')} ve ${branchTitles[branchTitles.length - 1]}`
    return `Bugün ${list} konularını işledik. Haritayı ister baştan dinleyebilirsin.`
  },
} as const

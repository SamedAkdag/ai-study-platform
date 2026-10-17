const PREFIX = 'studium.topicProgress.v1:'

export type TopicProgressState = {
  /** Topic ids marked done */
  done: string[]
  updatedAt: string
}

function key(scopeId: string) {
  return `${PREFIX}${scopeId}`
}

export function loadTopicProgress(scopeId: string): TopicProgressState {
  try {
    const raw = localStorage.getItem(key(scopeId))
    if (!raw) return { done: [], updatedAt: '' }
    const parsed = JSON.parse(raw) as Partial<TopicProgressState>
    return {
      done: Array.isArray(parsed.done)
        ? parsed.done.filter((x) => typeof x === 'string')
        : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return { done: [], updatedAt: '' }
  }
}

export function saveTopicProgress(scopeId: string, done: string[]) {
  const next: TopicProgressState = {
    done: [...new Set(done)],
    updatedAt: new Date().toISOString(),
  }
  try {
    localStorage.setItem(key(scopeId), JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
  return next
}

export function toggleTopicDone(scopeId: string, topicId: string): TopicProgressState {
  const cur = loadTopicProgress(scopeId)
  const has = cur.done.includes(topicId)
  const done = has
    ? cur.done.filter((id) => id !== topicId)
    : [...cur.done, topicId]
  return saveTopicProgress(scopeId, done)
}

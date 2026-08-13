export const hackerNewsSelectors = {
  age: '.age',
  author: '.hnuser',
  candidate: 'tr.athing[data-id]',
  comments: 'a[href^="item?id="]',
  points: '.score',
  title: '.titleline > a'
} as const

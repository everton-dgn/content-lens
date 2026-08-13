import {
  CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
  classificationModelOutputSchema
} from '@/ai/classification/model-output'

export { CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA }

export function parseModelOutputText(text: string) {
  try {
    return classificationModelOutputSchema.parse(JSON.parse(text))
  } catch {
    throw new Error('provider-output-invalid')
  }
}

export function requireTask(input: {
  task: string
  image?: { mimeType: string; dataBase64: string }
}) {
  if (
    input.task !== 'classification-text' &&
    input.task !== 'classification-vision'
  ) {
    throw new TypeError('Provider adapter task is unsupported')
  }
  if (
    (input.task === 'classification-text' && input.image !== undefined) ||
    (input.task === 'classification-vision' && input.image === undefined)
  ) {
    throw new TypeError('Provider adapter modality is invalid for the task')
  }
}

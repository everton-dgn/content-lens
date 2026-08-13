import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { PortableImportExportService } from '@/application/import-export/service'
import { createLocalProfile } from '@/application/profile/local-profile'
import {
  projectContentLensSettings,
  writeContentLensSettings
} from '@/application/settings/profile-settings'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const at = '2026-07-31T12:00:00.000Z'
const firstImportAt = '2026-07-31T13:00:00.000Z'
const mergeAt = '2026-07-31T14:00:00.000Z'

function database(factory: IDBFactory, name: string) {
  return new ContentLensDatabase({ factory, databaseName: name })
}

async function updateSettings(
  target: ContentLensDatabase,
  update: (
    settings: ReturnType<typeof projectContentLensSettings>['settings']
  ) => void
) {
  const profile = await target.exportProfile()
  if (!profile) {
    throw new Error('Profile unavailable in test')
  }
  const settings = projectContentLensSettings(profile.settings).settings
  update(settings)
  await target.saveProfile({
    ...profile,
    revision: profile.revision + 1,
    updatedAt: mergeAt,
    settings: writeContentLensSettings(profile.settings, settings)
  })
}

describe('manual import and export service', () => {
  it('establishes a base on replace and merges later independent changes', async () => {
    const factory = new IDBFactory()
    const sourceDatabase = database(factory, 'contentlens-portable-source')
    const targetDatabase = database(factory, 'contentlens-portable-target')
    await sourceDatabase.saveProfile(
      createLocalProfile({ at, profileId: 'profile:source' })
    )
    await targetDatabase.saveProfile(
      createLocalProfile({ at, profileId: 'profile:target' })
    )
    const source = new PortableImportExportService(sourceDatabase)
    const target = new PortableImportExportService(targetDatabase)

    const firstFile = await source.exportPlaintext(at)
    const firstPreview = await target.preview(firstFile)
    expect(firstPreview).toMatchObject({
      state: 'preview',
      preview: { merge: { state: 'unavailable', code: 'profile-mismatch' } }
    })
    if (firstPreview.state !== 'preview') {
      throw new Error('Expected first import preview')
    }
    await expect(
      target.replace(firstPreview.preview, {
        at: firstImportAt,
        operationId: 'operation:portable:first-replace'
      })
    ).resolves.toMatchObject({ state: 'imported' })

    await updateSettings(targetDatabase, settings => {
      settings.interface.colorMode = 'dark'
    })
    await updateSettings(sourceDatabase, settings => {
      settings.platforms.reddit.state = 'enabled'
    })
    const secondFile = await source.exportPlaintext(mergeAt)
    const secondPreview = await target.preview(secondFile)
    expect(secondPreview).toMatchObject({
      state: 'preview',
      preview: { merge: { state: 'ready' } }
    })
    if (
      secondPreview.state !== 'preview' ||
      secondPreview.preview.merge.state !== 'ready'
    ) {
      throw new Error('Expected merge-ready preview')
    }
    await expect(
      target.merge(secondPreview.preview, {
        at: mergeAt,
        operationId: 'operation:portable:merge'
      })
    ).resolves.toMatchObject({ state: 'imported' })

    const mergedProfile = await targetDatabase.exportProfile()
    if (!mergedProfile) {
      throw new Error('Merged profile unavailable')
    }
    const mergedSettings = projectContentLensSettings(
      mergedProfile.settings
    ).settings
    expect(mergedSettings.interface.colorMode).toBe('dark')
    expect(mergedSettings.platforms.reddit.state).toBe('enabled')
    expect(
      await targetDatabase.readSyncBase(
        secondPreview.preview.envelope.syncProfileId
      )
    ).toMatchObject({
      confirmedDigest: secondPreview.preview.envelope.digest
    })
  })

  it('rejects apply when the local revision changed after preview', async () => {
    const factory = new IDBFactory()
    const sourceDatabase = database(factory, 'contentlens-stale-source')
    const targetDatabase = database(factory, 'contentlens-stale-target')
    await sourceDatabase.saveProfile(
      createLocalProfile({ at, profileId: 'profile:source' })
    )
    await targetDatabase.saveProfile(
      createLocalProfile({ at, profileId: 'profile:target' })
    )
    const source = new PortableImportExportService(sourceDatabase)
    const target = new PortableImportExportService(targetDatabase)
    const preview = await target.preview(await source.exportPlaintext(at))
    if (preview.state !== 'preview') {
      throw new Error('Expected preview')
    }
    await updateSettings(targetDatabase, settings => {
      settings.interface.advancedMode = true
    })

    await expect(
      target.replace(preview.preview, {
        at: firstImportAt,
        operationId: 'operation:portable:stale'
      })
    ).resolves.toEqual({ state: 'stale-preview' })
  })
})

import { createServerFn } from '@tanstack/react-start'
import { requirePerm } from '../../perm/fn'
import { artistSaveInput, characterSaveInput, mergeInput, tagSaveInput, taxonomyDeleteInput, taxonomyListInput } from '../inputs'
import { deleteTaxonomy, listArtists, listCharacters, listTags, mergeTaxonomy, saveArtist, saveCharacter, saveTag } from '../taxonomy'

// 角色 · 画师 · 标签 (taxonomy: 站长 and 管理员).

export const adminCharactersFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('taxonomy')])
  .validator(taxonomyListInput)
  .handler(({ data }) => listCharacters(data.q))

export const adminArtistsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('taxonomy')])
  .validator(taxonomyListInput)
  .handler(({ data }) => listArtists(data.q))

export const adminTagsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('taxonomy')])
  .validator(taxonomyListInput)
  .handler(({ data }) => listTags(data.q))

export const adminSaveCharacterFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('taxonomy')])
  .validator(characterSaveInput)
  .handler(({ data, context }) => saveCharacter(context.viewer, data))

export const adminSaveArtistFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('taxonomy')])
  .validator(artistSaveInput)
  .handler(({ data, context }) => saveArtist(context.viewer, data))

export const adminSaveTagFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('taxonomy')])
  .validator(tagSaveInput)
  .handler(({ data, context }) => saveTag(context.viewer, data))

export const adminDeleteTaxonomyFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('taxonomy')])
  .validator(taxonomyDeleteInput)
  .handler(({ data, context }) => deleteTaxonomy(context.viewer, data))

export const adminMergeTaxonomyFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('taxonomy')])
  .validator(mergeInput)
  .handler(({ data, context }) => mergeTaxonomy(context.viewer, data))

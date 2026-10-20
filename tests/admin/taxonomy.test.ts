import { auditRows, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { deleteTaxonomy, listArtists, listCharacters, mergeTaxonomy, saveArtist, saveCharacter, saveTag } from '#/server/admin/taxonomy'
import { resolveLegacyPath } from '#/server/catalog/legacy'
import { db, schema } from '#/server/db/client'
import { seedArtist, seedCharacter, seedEmoji, seedPack } from './seed'

let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  manager = await userWithRole('manager', 'tax-manager')
}, 60_000)

async function aliasesOf(characterId: number) {
  return (await db().select().from(schema.characterAliases).where(eq(schema.characterAliases.characterId, characterId))).map((a) => a.alias).sort()
}

describe('characters', () => {
  test('create with a pinyin slug, aliases and theme color; rename slug writes a 301', async () => {
    const { id, slug } = await saveCharacter(manager.actor, { name: '守岸人', aliases: ['岸岸'], themeColor: 'var(--c-blue)' })
    expect(slug).toBe('shouanren')
    expect(await aliasesOf(id)).toEqual(['岸岸'])
    await saveCharacter(manager.actor, { id, name: '守岸人', slug: 'shorekeeper' })
    const [r] = await db().select().from(schema.redirects).where(eq(schema.redirects.fromPath, '/characters/shouanren'))
    expect(r!.toPath).toBe('/characters/shorekeeper')
    expect(await auditRows('character.create', id)).toHaveLength(1)
    expect((await auditRows('character.update', id))[0]!.diff).toEqual({ slug: ['shouanren', 'shorekeeper'] })
  })

  test('an alias owned by another character is refused (409)', async () => {
    const a = await seedCharacter(uniq('甲'))
    await saveCharacter(manager.actor, { id: a.id, name: a.name, aliases: ['重名别名'] })
    const b = await seedCharacter(uniq('乙'))
    const err = await saveCharacter(manager.actor, { id: b.id, name: b.name, aliases: ['重名别名'] }).catch((e) => e)
    expect(err.status).toBe(409)
  })

  test('hash slugs are flagged with a suggestion', async () => {
    await seedCharacter('男漂泊者', { slug: 'submission-term-f5269ada382dd306c431e627' })
    const rows = await listCharacters('男漂泊者')
    expect(rows[0]!.hashSlug).toBe(true)
    expect(rows[0]!.suggestedSlug).toBe('nanpiaobozhe')
  })

  test('merge A into B: links move without duplicates, aliases and name move, old slugs 301, A is gone', async () => {
    const pack1 = await seedPack({ packKey: uniq('merge-1') })
    const pack2 = await seedPack({ packKey: uniq('merge-2') })
    const e1 = await seedEmoji(pack1)
    const from = await seedCharacter(uniq('女漂泊者'), { slug: uniq('nvpiaobozhe'), legacySlug: uniq('character-51a9fdce') })
    const to = await seedCharacter(uniq('漂泊者'), { slug: uniq('piaobozhe') })
    await db().insert(schema.characterAliases).values([
      { characterId: from.id, alias: uniq('女主') },
      { characterId: to.id, alias: uniq('漂泊') },
    ])
    // pack1 is linked to both (conflict on the composite key), pack2 only to A
    await db().insert(schema.packCharacters).values([
      { packId: pack1.id, characterId: from.id },
      { packId: pack1.id, characterId: to.id },
      { packId: pack2.id, characterId: from.id },
    ])
    await db().insert(schema.emojiCharacters).values({ emojiId: e1.id, characterId: from.id })
    // an older redirect pointing at A follows along
    await db().insert(schema.redirects).values({ fromPath: `/characters/${uniq('older')}`, toPath: `/characters/${from.slug}` })

    const res = await mergeTaxonomy(manager.actor, { kind: 'character', fromId: from.id, toId: to.id, keepName: true })

    expect(res.packsMoved).toBe(1)
    expect(res.emojisMoved).toBe(1)
    expect(await db().select().from(schema.characters).where(eq(schema.characters.id, from.id))).toHaveLength(0)
    const links = await db().select().from(schema.packCharacters).where(eq(schema.packCharacters.characterId, to.id))
    expect(links.map((l) => l.packId).sort()).toEqual([pack1.id, pack2.id].sort())
    const aliases = await aliasesOf(to.id)
    expect(aliases).toContain(from.name)
    expect(aliases).toHaveLength(3)
    for (const s of [from.slug, from.legacySlug!]) {
      const [r] = await db().select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/characters/${s}`))
      expect(r!.toPath).toBe(`/characters/${to.slug}`)
    }
    const old = await db().select().from(schema.redirects).where(eq(schema.redirects.toPath, `/characters/${from.slug}`))
    expect(old).toHaveLength(0)
    expect((await resolveLegacyPath(`/characters/${from.slug}`))?.location).toBe(`/characters/${to.slug}`)
    const [c] = await db().select().from(schema.characters).where(eq(schema.characters.id, to.id))
    expect(c!.packCount).toBe(2)
    const [a] = await auditRows('character.merge', to.id)
    expect(a!.diff).toMatchObject({ from: { id: from.id }, to: { id: to.id }, packsMoved: 1 })
  })

  test('cannot delete a character that is still linked', async () => {
    const pack = await seedPack({ packKey: uniq('del-char') })
    const c = await seedCharacter(uniq('在用'))
    await db().insert(schema.packCharacters).values({ packId: pack.id, characterId: c.id })
    const err = await deleteTaxonomy(manager.actor, { kind: 'character', id: c.id }).catch((e) => e)
    expect(err.status).toBe(409)
    const free = await seedCharacter(uniq('空闲'))
    await deleteTaxonomy(manager.actor, { kind: 'character', id: free.id })
    expect(await auditRows('character.delete', free.id)).toHaveLength(1)
  })
})

describe('artists and tags', () => {
  test('artist merge keeps both roles and links, spelling variants become aliases', async () => {
    const pack = await seedPack({ packKey: uniq('artist-merge') })
    const from = await seedArtist(uniq('春也Huruya'), { links: [{ label: 'B 站', url: 'https://example.test/a' }] })
    const to = await seedArtist(uniq('春也Haruya'))
    await db().insert(schema.packArtists).values([
      { packId: pack.id, artistId: from.id, role: 'artist' },
      { packId: pack.id, artistId: from.id, role: 'commissioner' },
    ])
    const res = await mergeTaxonomy(manager.actor, { kind: 'artist', fromId: from.id, toId: to.id, keepName: true })
    expect(res.packsMoved).toBe(2)
    const roles = (await db().select().from(schema.packArtists).where(eq(schema.packArtists.artistId, to.id))).map((r) => r.role).sort()
    expect(roles).toEqual(['artist', 'commissioner'])
    const row = (await listArtists(to.name))[0]!
    expect(row.aliases).toContain(from.name)
    expect(row.links).toEqual([{ label: 'B 站', url: 'https://example.test/a' }])
  })

  test('artist names with stray spaces are flagged; rename writes a redirect', async () => {
    const a = await seedArtist(' 带空格的画师 ', { slug: uniq('space') })
    expect((await listArtists('带空格的画师'))[0]!.untrimmed).toBe(true)
    await saveArtist(manager.actor, { id: a.id, name: '带空格的画师', slug: `${a.slug}-x` })
    const [r] = await db().select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/artists/${a.slug}`))
    expect(r!.toPath).toBe(`/artists/${a.slug}-x`)
  })

  test('tags: create, duplicate slug in a dimension is 409, merge moves pack links', async () => {
    const pack = await seedPack({ packKey: uniq('tag-merge') })
    const a = await saveTag(manager.actor, { dimension: 'group', name: '站长推荐', slug: uniq('tuijian') })
    const dup = await saveTag(manager.actor, { dimension: 'group', name: '重复', slug: a.slug }).catch((e) => e)
    expect(dup.status).toBe(409)
    const b = await saveTag(manager.actor, { dimension: 'group', name: '推荐', slug: uniq('tuijian2') })
    await db().insert(schema.packTags).values({ packId: pack.id, tagId: a.id })
    await mergeTaxonomy(manager.actor, { kind: 'tag', fromId: a.id, toId: b.id, keepName: true })
    const links = await db().select().from(schema.packTags).where(eq(schema.packTags.packId, pack.id))
    expect(links.map((l) => l.tagId)).toEqual([b.id])
    expect(await auditRows('tag.merge', b.id)).toHaveLength(1)
  })
})

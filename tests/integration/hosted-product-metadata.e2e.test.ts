import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sql from 'mssql';
import { closeHostedPools, getHostedStorePool, hostedDbName } from '../../src/core/db/hostedSql';
import { runWithStoreContext } from '../../src/core/db/pool';
import { HostedProductMetadataStore } from '../../src/core/db/productMetadataStore';

const testStoreIds = process.env.OP_SQL_TEST_STORE_IDS;

test('hosted categories and Unicode product metadata are isolated by store', {
  skip: testStoreIds ? false : 'Set OP_SQL_TEST_STORE_IDS to two provisioned staging stores',
}, async () => {
  const storeIds = testStoreIds!.split(',').map(Number);
  assert.equal(storeIds.length, 2);
  assert.ok(storeIds.every((id) => Number.isInteger(id) && id > 0));
  const [storeA, storeB] = storeIds;
  assert.notEqual(storeA, storeB);

  const metadata = new HostedProductMetadataStore();
  const barcode = `metadata-test-${randomUUID()}`;
  const actor = 'metadata-integration';

  try {
    const [poolA, poolB] = await Promise.all([getHostedStorePool(storeA), getHostedStorePool(storeB)]);
    const dbIdentity = (pool: sql.ConnectionPool, other: number) => pool.request()
      .input('other', sql.NVarChar(128), hostedDbName(other))
      .query<{ name: string; canAccessOther: number | null }>(
        'SELECT DB_NAME() AS name, HAS_DBACCESS(@other) AS canAccessOther'
      );
    const [identityA, identityB] = await Promise.all([dbIdentity(poolA, storeB), dbIdentity(poolB, storeA)]);
    assert.equal(identityA.recordset[0].name, hostedDbName(storeA));
    assert.equal(identityB.recordset[0].name, hostedDbName(storeB));
    assert.notEqual(identityA.recordset[0].canAccessOther, 1);
    assert.notEqual(identityB.recordset[0].canAccessOther, 1);

    const dictionaries = await Promise.all([
      runWithStoreContext(storeA, () => metadata.listCategories()),
      runWithStoreContext(storeB, () => metadata.listCategories()),
    ]);
    for (const dictionary of dictionaries) {
      assert.ok(dictionary.some((entry) =>
        entry.code === 'food_snack' && entry.name_zh === '食品零食' && entry.name_sk === 'Potraviny a pochutiny'
      ));
    }

    await runWithStoreContext(storeA, () =>
      metadata.upsertProductMeta(barcode, 'food_snack', '蓝莓果酱 – Crème brûlée', actor)
    );
    const beforeB = await runWithStoreContext(storeB, () => metadata.getAllProductMetaMap([barcode]));
    assert.equal(beforeB.has(barcode), false);

    const [afterA, afterB] = await Promise.all([
      runWithStoreContext(storeA, async () => {
        assert.equal(await metadata.batchUpsertCategories([{ barcode, category: 'home_kitchen' }], actor), 1);
        return (await metadata.getAllProductMetaMap([barcode])).get(barcode);
      }),
      runWithStoreContext(storeB, () =>
        metadata.upsertProductMeta(barcode, 'food_drink', '柠檬苏打 – Citron pressé', actor)
      ),
    ]);
    assert.equal(afterA?.category, 'home_kitchen');
    assert.equal(afterA?.name_zh, '蓝莓果酱 – Crème brûlée');
    assert.equal(afterB.category, 'food_drink');
    assert.equal(afterB.name_zh, '柠檬苏打 – Citron pressé');

    await runWithStoreContext(storeA, async () => {
      await assert.rejects(metadata.batchUpsertCategories([
        { barcode, category: 'food_snack' },
        { barcode: `${barcode}-invalid`, category: 'invalid-category' },
      ], actor));
      assert.equal((await metadata.getAllProductMetaMap([barcode])).get(barcode)?.category, 'home_kitchen');
      const cleared = await metadata.upsertProductMeta(barcode, null, '', actor);
      assert.equal(cleared.name_zh, null);
    });
  } finally {
    await Promise.allSettled([
      runWithStoreContext(storeA, () => metadata.deleteProductMeta(barcode)),
      runWithStoreContext(storeB, () => metadata.deleteProductMeta(barcode)),
    ]);
    await closeHostedPools();
  }
});

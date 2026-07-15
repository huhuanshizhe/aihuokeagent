import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThaiFactoryCsv, rankThaiFactories } from '../adapters/thailand-factory.js';
import { qualifyDiscoveredCandidate } from '../scan/qualifier.js';
import type { NormalizedCandidate, SearchQuery } from '../adapters/types.js';

const csv = `FACREG,FNAME,ONAME,OBJECT,FPROVNAME,TOTAL_WORKER,LAT,LNG,ISIC_CODE,LAST_UPDATE
"FAC-1","โรงงานสีรถยนต์","บริษัท ออโต้เพนท์ จำกัด","ผลิตชิ้นส่วนรถยนต์และพ่นสี","ชลบุรี","120","13.1","101.2","29309","2026-07-13"
"FAC-2","โรงสีข้าว","นายตัวอย่าง","สีข้าว","เชียงราย","8","","","10611","2026-07-13"`;

test('DIW CSV parser preserves official factory identity and industrial evidence', () => {
  const records = parseThaiFactoryCsv(csv);
  assert.equal(records.length, 2);
  assert.equal(records[0].operatorName, 'บริษัท ออโต้เพนท์ จำกัด');
  assert.equal(records[0].totalWorkers, 120);
});

test('English automotive painting intent ranks the matching Thai factory first', () => {
  const ranked = rankThaiFactories(parseThaiFactoryCsv(csv), ['automotive painting manufacturer']);
  assert.equal(ranked[0].record.registrationId, 'FAC-1');
  assert.ok(ranked[0].matchedTerms.includes('รถยนต์'));
  assert.ok(ranked[0].matchedTerms.includes('พ่นสี'));
});

test('official registry keyword evidence is sufficient for a qualified company candidate', () => {
  const query: SearchQuery = { keywords: ['automotive painting manufacturer'], countries: ['TH'] };
  const candidate: NormalizedCandidate = {
    externalId: 'FAC-1',
    sourceUrl: 'https://www.diw.go.th/webdiw/search-factory/',
    displayName: 'บริษัท ออโต้เพนท์ จำกัด',
    candidateType: 'COMPANY',
    description: 'ผลิตชิ้นส่วนรถยนต์และพ่นสี',
    country: 'Thailand',
    matchExplain: { channel: 'thailand_factory', reasons: [] },
    rawData: { source: 'thailand_factory', sourceMatchedKeywords: ['automotive painting manufacturer'] },
  };
  const result = qualifyDiscoveredCandidate(candidate, query);
  assert.equal(result.tier, 'qualified');
  assert.ok(result.score >= 0.6);
});

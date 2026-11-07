import { expect, test } from 'bun:test';
import {
  buildClickScript,
  buildInspectScript,
  buildScrollScript,
  buildSelectScript,
  buildSnapshotScript,
  buildTypeScript,
} from '../src/service/pageScripts.ts';

const scripts = [
  buildSnapshotScript(),
  buildSnapshotScript({ selector: '#main' }),
  buildClickScript({ selector: '#save' }),
  buildClickScript({ text: 'Save' }),
  buildClickScript({ selector: 'a[data-x="1"]' }),
  buildTypeScript({ selector: '#name', value: 'Ada "Lovelace"', submit: true }),
  buildSelectScript({ selector: '#country', label: 'Canada' }),
  buildSelectScript({ selector: '#country', value: 'ca' }),
  buildScrollScript({ direction: 'down' }),
  buildScrollScript({ selector: '#footer' }),
  buildInspectScript({ selector: '#save' }),
];

test('every page script parses as JavaScript', () => {
  for (const script of scripts) {
    expect(() => new Function(`return ${script}`)).not.toThrow();
  }
});

test('the snapshot script keeps its answer under the relay value cap', () => {
  expect(buildSnapshotScript()).toContain('var budget = 28000');
});

test('a selector with a quote stays inside its JSON string', () => {
  const script = buildClickScript({ selector: 'a[data-x="1"]' });
  expect(script).toContain('a[data-x=\\"1\\"]');
  expect(() => new Function(`return ${script}`)).not.toThrow();
});

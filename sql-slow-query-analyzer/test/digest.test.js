import test from 'node:test';
import assert from 'node:assert/strict';
import { maskStrings, stripComments, normalizeQuery } from '../src/digest.js';

test('maskStrings - single and double quotes', () => {
  const sql = "SELECT * FROM users WHERE name = 'John' AND email = \"john@example.com\"";
  const expected = "SELECT * FROM users WHERE name = ? AND email = ?";
  assert.equal(maskStrings(sql), expected);
});

test('maskStrings - escaped quotes inside strings', () => {
  const sql = "SELECT * FROM users WHERE name = 'John\\'s Phone' AND description = \"He said \\\"Hello\\\"\"";
  const expected = "SELECT * FROM users WHERE name = ? AND description = ?";
  assert.equal(maskStrings(sql), expected);
});

test('maskStrings - doubled single quotes as escaping', () => {
  const sql = "SELECT * FROM users WHERE name = 'John''s Phone'";
  const expected = "SELECT * FROM users WHERE name = ?";
  assert.equal(maskStrings(sql), expected);
});

test('maskStrings - backticks dropped but identifiers kept', () => {
  const sql = "SELECT `id`, `name` FROM `users` WHERE `status` = 'active'";
  const expected = "SELECT id, name FROM users WHERE status = ?";
  assert.equal(maskStrings(sql), expected);
});

test('stripComments - block and line comments', () => {
  const sql = `
    /* This is a block comment */
    SELECT * -- This is a line comment
    # Another comment on its own line
    FROM users
    WHERE id = 1
  `;
  const stripped = stripComments(sql);
  assert.match(stripped, /SELECT \*/);
  assert.match(stripped, /FROM users/);
  assert.match(stripped, /WHERE id = 1/);
  assert.doesNotMatch(stripped, /block comment/);
  assert.doesNotMatch(stripped, /line comment/);
  assert.doesNotMatch(stripped, /Another comment/);
});

test('normalizeQuery - converts numbers and hex to ?', () => {
  const sql = "SELECT * FROM posts WHERE id = 123 AND hex_col = 0xabcdef AND price = -45.67e-2";
  const expected = "select * from posts where id = ? and hex_col = ? and price = ?";
  assert.equal(normalizeQuery(sql), expected);
});

test('normalizeQuery - normalizes spacing and case', () => {
  const sql = "SELECT   id,   name   FROM   users   WHERE   id=1";
  const expected = "select id, name from users where id = ?";
  assert.equal(normalizeQuery(sql), expected);
});

test('normalizeQuery - collapses IN-lists and VALUES', () => {
  const sql = "SELECT * FROM users WHERE id IN (1, 2, 3, 4, 5)";
  const expected = "select * from users where id in (?)";
  assert.equal(normalizeQuery(sql), expected);

  const insertSql = "INSERT INTO users (id, name) VALUES (1, 'a'), (2, 'b')";
  const expectedInsert = "insert into users (id, name) values (?), (?, ?)";
  assert.equal(normalizeQuery(insertSql), expectedInsert);
});

test('normalizeQuery - operators spacing', () => {
  const sql = "SELECT * FROM users WHERE a<=>1 AND b<=2 AND c>=3 AND d<>4 AND e!=5 AND f=6 AND g<7 AND h>8";
  const expected = "select * from users where a <=> ? and b <= ? and c >= ? and d <> ? and e != ? and f = ? and g < ? and h > ?";
  assert.equal(normalizeQuery(sql), expected);
});

import assert from 'node:assert/strict'
import test from 'node:test'
import { photoErrorMessage } from '../src/utils/photoErrors.js'

const fallback = 'Не удалось добавить фотографии'

test('proxy HTML 413 responses explain the server upload limit', () => {
  const error = { response: { status: 413, data: '<html>413 Request Entity Too Large</html>' } }
  const message = photoErrorMessage(error, fallback)
  assert.ok(message.includes('ограничения размера'))
  assert.ok(message.includes('HTTP 413'))
})

test('specific API errors take precedence over generic status descriptions', () => {
  for (const [status, detail] of [[413, 'Размер одной фотографии не должен превышать 10 МБ'],
    [415, 'Поддерживаются фотографии JPEG, PNG и WebP'], [409, 'Не более 10 фотографий']]) {
    assert.equal(photoErrorMessage({ response: { status, data: { detail } } }, fallback), detail)
  }
  assert.equal(photoErrorMessage({ response: { status: 422, data: { detail: [{ msg: 'Выберите фотографии' }] } } }, fallback), 'Выберите фотографии')
})

test('server and network failures remain distinguishable', () => {
  assert.equal(photoErrorMessage({ response: { status: 500, data: 'Internal Server Error' } }, fallback), `${fallback} (HTTP 500)`)
  assert.ok(photoErrorMessage({ code: 'ERR_NETWORK' }, fallback).includes('Нет соединения'))
  assert.equal(photoErrorMessage({}, fallback), fallback)
})

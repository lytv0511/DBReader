import { describe, it, expect } from 'vitest';
import { allTopics, getTopic, matchHelp } from '../lib/help';

describe('help matcher', () => {
  it('matches canvas queries', () => {
    expect(matchHelp('how do I add a table node to the canvas')?.id).toBe('canvas');
    expect(matchHelp('connect filter node output')?.id).toBe('canvas');
  })

  it('matches query editor queries', () => {
    expect(matchHelp('how to run sql')?.id).toBe('query');
    expect(matchHelp('execute a select query')?.id).toBe('query');
  })

  it('matches quick use queries', () => {
    expect(matchHelp('how do I record quick use of a product')?.id).toBe('quickuse');
    expect(matchHelp('record usage fast')?.id).toBe('quickuse');
  })

  it('matches cost queries', () => {
    expect(matchHelp('how much does a product cost')?.id).toBe('cost');
    expect(matchHelp('set the price')?.id).toBe('cost');
  })

  it('matches tab reorder queries', () => {
    expect(matchHelp('reorder the tabs')?.id).toBe('tabs');
    expect(matchHelp('drag tab order')?.id).toBe('tabs');
  })

  it('matches settings queries', () => {
    expect(matchHelp('change the language and theme')?.id).toBe('settings');
  })

  it('returns null for gibberish', () => {
    expect(matchHelp('asdf qwerty zxcv')).toBeNull();
    expect(matchHelp('')).toBeNull();
    expect(matchHelp('!@#$%^&*()')).toBeNull();
  })

  it('case insensitive', () => {
    expect(matchHelp('HOW TO SAVE A PRESET')?.id).toBe('presets');
  })

  it('exposes all topics and lookup', () => {
    expect(allTopics().length).toBe(18)
    expect(getTopic('batches')?.id).toBe('batches')
    expect(getTopic('nope')).toBeNull()
  })
})

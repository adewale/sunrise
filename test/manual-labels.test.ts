import { describe, expect, it } from 'vitest';
import labels from '../fixtures/manual-labels-50-template.json';

describe('manual labeling corpus scaffolding', () => {
  it('provides a 50-candidate template with the fields needed for classifier regression tests', () => {
    expect(labels).toHaveLength(50);
    for (const [index, label] of labels.entries()) {
      expect(label.candidateId).toBe(`candidate-${String(index + 1).padStart(3, '0')}`);
      expect(label).toHaveProperty('source');
      expect(label).toHaveProperty('url');
      expect(label).toHaveProperty('actionable');
      expect(label).toHaveProperty('expectedPriority');
      expect(label).toHaveProperty('expectedKind');
      expect(label).toHaveProperty('notes');
    }
  });
});

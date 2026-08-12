import { describe, it, expect } from 'vitest';
import {
  activityTitleFor, activityDetailLabelFor, initBuildActivity, ACTIVITY_TITLES,
} from '@/lib/webBuildActivity';

/** Post-merge audit — the activity timeline LABELS must be build-type aware: an app
 *  build never says "website direction"; a web build is unchanged. Stage IDs are
 *  identical (no duplicate state machine). */
describe('activity labels — build-type aware', () => {
  it('B. an app build says "product direction", never "website direction"', () => {
    expect(activityTitleFor('research', 'app')?.en).toBe('Researching the product direction');
    expect(activityTitleFor('planning', 'app')?.en).toBe('Creating the app strategy');
    expect(activityTitleFor('research', 'app')?.en).not.toMatch(/website/i);
    // German + Turkish app variants are real, not English fallbacks.
    expect(activityTitleFor('research', 'app')?.de).not.toMatch(/website-richtung/i);
    expect(activityTitleFor('planning', 'app')?.tr).toMatch(/uygulama/i);
  });

  it('C. a web build (or absent build type) keeps the existing website labels', () => {
    expect(activityTitleFor('research', 'web')?.en).toBe('Researching the website direction');
    expect(activityTitleFor('research', undefined)?.en).toBe('Researching the website direction');
    expect(activityTitleFor('planning', 'web')?.en).toBe('Creating the website strategy');
    // A stage with no app override falls back to the shared web title for both.
    expect(activityTitleFor('acceptance', 'app')).toBe(ACTIVITY_TITLES.acceptance);
    expect(activityTitleFor('acceptance', 'web')).toBe(ACTIVITY_TITLES.acceptance);
  });

  it('detail labels are build-type aware (App language / Planned screens)', () => {
    expect(activityDetailLabelFor('language', 'app')?.en).toBe('App language');
    expect(activityDetailLabelFor('language', 'web')?.en).toBe('Website language');
    expect(activityDetailLabelFor('sections', 'app')?.en).toBe('Planned screens');
    expect(activityDetailLabelFor('sections', 'web')?.en).toBe('Planned sections');
  });

  it('the activity STATE carries buildType (drives labels; same stage IDs)', () => {
    const appState = initBuildActivity('app');
    const webState = initBuildActivity('web');
    const legacyState = initBuildActivity();
    expect(appState.buildType).toBe('app');
    expect(webState.buildType).toBe('web');
    expect(legacyState.buildType).toBeUndefined();
    // Same canonical stage IDs regardless of build type (no duplicate state machine).
    expect(appState.items.map((i) => i.id)).toEqual(webState.items.map((i) => i.id));
  });
});

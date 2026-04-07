import { describe, test, expect } from 'vitest';

const SequenceUI = require('../../../frontend/SequenceUI/SequenceUI.web.js');

describe('SequenceUI duplicate semantic feedback', () => {
  test('maps checked user-created levels to backend-confirmed block ids', () => {
    const resolved = SequenceUI.__testHooks.resolveCheckedCorrectBlocksByLevel({
      lastCheckDetails: {
        correct_blocks_by_level: {
          level_left_arm: ['elem_yellow_runtime'],
          level_chest: ['elem_red_chest', 'elem_yellow_canonical'],
        },
        correct_levels: [
          { level_id: 'level_left_arm', blocks: ['elem_yellow_canonical'] },
          { level_id: 'level_chest', blocks: ['elem_red_chest', 'elem_yellow_runtime'] },
        ],
      },
      lastRawResultDetails: {
        correct_levels_data: [
          { level_id: 'level_left_arm', level_name: 'Левая рука', blocks: ['elem_yellow_canonical'] },
          { level_id: 'level_chest', level_name: 'Грудь', blocks: ['elem_red_chest', 'elem_yellow_runtime'] },
        ],
      },
      userCreatesLevels: true,
      requiresBlockNames: false,
      difficulty: 2,
      levelList: [
        { level_id: 'user_level_left_arm', label: 'Левая рука' },
        { level_id: 'user_level_chest', label: 'Грудь' },
      ],
      placementList: [
        { level_id: 'user_level_left_arm', blocks: ['elem_yellow_runtime'] },
        { level_id: 'user_level_chest', blocks: ['elem_red_chest', 'elem_yellow_canonical'] },
      ],
      sequenceWithinLevelMatters: true,
      originalLevelLabelById: {
        level_left_arm: 'Левая рука',
        level_chest: 'Грудь',
      },
    });

    expect(resolved.get('user_level_left_arm')).toEqual(['elem_yellow_runtime']);
    expect(resolved.get('user_level_chest')).toEqual(['elem_red_chest', 'elem_yellow_canonical']);
  });
});

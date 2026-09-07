import test from 'node:test';
import assert from 'node:assert/strict';

// Helper functions extracted directly from frontend/Complexes/create.html
function getChainTasks(chain) {
  if (!chain) return [];
  if (Array.isArray(chain)) return chain;
  if (Array.isArray(chain.tasks)) return chain.tasks;
  return [];
}

function getChainShuffleMode(chain) {
  if (!chain || Array.isArray(chain)) return 'never';
  return chain.shuffle_mode || 'never';
}

function getAllChainedRefs(chains) {
  const refs = [];
  for (const ch of (chains || [])) {
    refs.push(...getChainTasks(ch));
  }
  return refs;
}

function getMaxIterations(complexSettings) {
  const settings = complexSettings || {};
  const val = parseInt(settings.max_iterations, 10);
  return Number.isFinite(val) && val > 0 ? val : 3;
}

function getValidShufflePresets(maxIter) {
  const options = [
    { value: 'never', minIter: 1 },
    { value: 'from_iteration_2', minIter: 2 },
    { value: 'only_iteration_3', minIter: 3 },
    { value: 'always', minIter: 1 },
  ];
  return options.filter(opt => maxIter >= opt.minIter).map(o => o.value);
}

test('getChainTasks handles legacy arrays and modern objects', () => {
  assert.deepEqual(getChainTasks(['task1', 'task2']), ['task1', 'task2']);
  assert.deepEqual(
    getChainTasks({ tasks: ['taskA', 'taskB'], shuffle_mode: 'from_iteration_2' }),
    ['taskA', 'taskB']
  );
  assert.deepEqual(getChainTasks(null), []);
  assert.deepEqual(getChainTasks({}), []);
});

test('getChainShuffleMode defaults legacy arrays to never and preserves object mode', () => {
  assert.equal(getChainShuffleMode(['task1', 'task2']), 'never');
  assert.equal(
    getChainShuffleMode({ tasks: ['taskA', 'taskB'], shuffle_mode: 'from_iteration_2' }),
    'from_iteration_2'
  );
  assert.equal(getChainShuffleMode({ tasks: ['taskA', 'taskB'] }), 'never');
});

test('getAllChainedRefs flattens mixed chains correctly', () => {
  const mixedChains = [
    ['t1', 't2'],
    { tasks: ['t3', 't4'], shuffle_mode: 'always' },
  ];
  assert.deepEqual(getAllChainedRefs(mixedChains), ['t1', 't2', 't3', 't4']);
});

test('getMaxIterations fallback and extraction', () => {
  assert.equal(getMaxIterations(null), 3);
  assert.equal(getMaxIterations({}), 3);
  assert.equal(getMaxIterations({ max_iterations: 2 }), 2);
  assert.equal(getMaxIterations({ max_iterations: '5' }), 5);
  assert.equal(getMaxIterations({ max_iterations: 0 }), 3);
});

test('getValidShufflePresets filters based on maxIterations', () => {
  // max_iterations = 1: only never and always
  assert.deepEqual(getValidShufflePresets(1), ['never', 'always']);

  // max_iterations = 2: never, from_iteration_2, always (only_iteration_3 is excluded)
  assert.deepEqual(getValidShufflePresets(2), ['never', 'from_iteration_2', 'always']);
  assert.ok(!getValidShufflePresets(2).includes('only_iteration_3'));

  // max_iterations = 3: all presets available
  assert.deepEqual(getValidShufflePresets(3), ['never', 'from_iteration_2', 'only_iteration_3', 'always']);
  assert.ok(getValidShufflePresets(3).includes('only_iteration_3'));
});

test('Reordering tasks inside chain via up and down swaps', () => {
  const chain = {
    tasks: ['task_1', 'task_2', 'task_3'],
    shuffle_mode: 'never',
  };

  // Move index 1 (task_2) up -> swaps with task_1
  const moveUp = (idx, i) => {
    if (i <= 0) return;
    const tmp = chain.tasks[i - 1];
    chain.tasks[i - 1] = chain.tasks[i];
    chain.tasks[i] = tmp;
  };

  moveUp(0, 1);
  assert.deepEqual(chain.tasks, ['task_2', 'task_1', 'task_3']);

  // Move index 0 up -> boundary condition, nothing happens
  moveUp(0, 0);
  assert.deepEqual(chain.tasks, ['task_2', 'task_1', 'task_3']);

  // Move index 1 (task_1) down -> swaps with task_3
  const moveDown = (idx, i) => {
    if (i >= chain.tasks.length - 1) return;
    const tmp = chain.tasks[i + 1];
    chain.tasks[i + 1] = chain.tasks[i];
    chain.tasks[i] = tmp;
  };

  moveDown(0, 1);
  assert.deepEqual(chain.tasks, ['task_2', 'task_3', 'task_1']);

  // Move index 2 down -> boundary condition, nothing happens
  moveDown(0, 2);
  assert.deepEqual(chain.tasks, ['task_2', 'task_3', 'task_1']);
});

test('Removing task from complex preserves chain settings if >= 2 tasks remain', () => {
  let chains = [
    { tasks: ['t1', 't2', 't3'], shuffle_mode: 'from_iteration_2' },
    { tasks: ['t4', 't5'], shuffle_mode: 'always' },
  ];

  const removeTask = (ref) => {
    const newChains = [];
    for (const ch of chains) {
      const tasks = getChainTasks(ch);
      const filtered = tasks.filter(x => x !== ref);
      if (filtered.length >= 2) {
        newChains.push({ ...ch, tasks: filtered });
      }
    }
    chains = newChains;
  };

  // Remove t3 -> chain 0 still has 2 tasks, preserves shuffle_mode
  removeTask('t3');
  assert.equal(chains.length, 2);
  assert.deepEqual(chains[0].tasks, ['t1', 't2']);
  assert.equal(chains[0].shuffle_mode, 'from_iteration_2');

  // Remove t5 -> chain 1 only has 1 task left, automatically dismantled
  removeTask('t5');
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].tasks, ['t1', 't2']);
});

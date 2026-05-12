import random
import hashlib

def _chunk_variety_key(chunk):
    task = chunk[0]
    if task.get("display_mode") == "scattered":
        return "scattered_q"
    return "test"

tasks = []
for task_id in range(15):
    for q_idx in range(19):
        tasks.append([{"task_ref": f"task_{task_id}", "display_mode": "scattered", "q_idx": q_idx}])

by_type = {}
for chunk in tasks:
    vkey = _chunk_variety_key(chunk)
    by_type.setdefault(vkey, []).append(chunk)

seed_base = "test_session_id:1"
phase_id = 0

for vkey, group_chunks in by_type.items():
    seed_material = f"{seed_base}:vkey:{vkey}:{phase_id}".encode("utf-8", errors="ignore")
    seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big", signed=False)
    state = random.getstate()
    try:
        random.seed(seed_int)
        random.shuffle(group_chunks)
    finally:
        random.setstate(state)

if len(by_type) <= 1:
    result = []
    for chunk in list(by_type.values())[0]:
        result.extend(chunk)

for i in range(25):
    print(result[i])

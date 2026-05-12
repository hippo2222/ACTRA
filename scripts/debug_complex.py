import json
import os
import sys

# Add project root to sys.path
sys.path.append('/app/desktop-app')

from persistence.hosted_complex_repository import HostedComplexRepository

def main():
    dsn = os.environ.get('ACTRA_POSTGRES_DSN')
    if not dsn:
        print("ACTRA_POSTGRES_DSN not found in environment")
        return
        
    repo = HostedComplexRepository(dsn=dsn)
    complex_id = 'd91ad43f-98be-4a7d-8e16-e43cfbf371c0'
    c_dict = repo.get_complex(complex_id)
    if not c_dict:
        print(f"Complex {complex_id} not found")
        return
    
    print(f"Complex ID: {c_dict.get('id')}")
    print(f"Complex Name: {c_dict.get('name')}")
    
    chains = c_dict.get('chains', [])
    print(f"Chains: {chains}")
    
    settings = c_dict.get('settings', {})
    modes = settings.get('test_question_display_modes')
    print(f"test_question_display_modes count: {len(modes) if modes else 0}")
    
    # Check if a specific task is in chains
    task_ref = 'learning_radiology_glava_1/tema_1_tekhnicheski_pravilnyj_rentgen_ogk/img_2.9'
    found_in_chains = False
    for chain in chains:
        if task_ref in chain:
            found_in_chains = True
            break
    print(f"Task {task_ref} found in chains: {found_in_chains}")
    print(f"Task {task_ref} display_mode in settings: {modes.get(task_ref) if modes else 'N/A'}")

if __name__ == "__main__":
    main()

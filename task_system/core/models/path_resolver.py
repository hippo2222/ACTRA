"""
Path resolver utilities for handling relative paths in tasks.

All paths in JSON files should be relative to task.json location.
This module provides utilities for resolving and normalizing paths.
"""

from pathlib import Path
from typing import Optional, List
import logging

logger = logging.getLogger(__name__)


class PathResolver:
    """Utility class for resolving paths relative to task.json."""
    
    @staticmethod
    def resolve_image_path(image_path: str, task_json_path: Path) -> Path:
        """
        Resolve image path relative to task.json.
        
        Args:
            image_path: Path to image (relative, absolute, or from project root)
            task_json_path: Path to task.json file
        
        Returns:
            Resolved absolute Path to image
        """
        task_dir = task_json_path.parent
        path_obj = Path(image_path)
        
        # If absolute path, return normalized absolute path
        if path_obj.is_absolute():
            return path_obj.resolve()
        
        relative_path = task_dir / path_obj
        if relative_path.exists():
            return relative_path.resolve()
        
        filename_path = task_dir / path_obj.name
        if filename_path.exists():
            return filename_path.resolve()
        
        # If file is missing, keep original relative path for manual review
        return path_obj
    
    @staticmethod
    def resolve_relative_path(relative_path: str, task_json_path: Path) -> Path:
        """
        Resolve any relative path relative to task.json.
        
        Args:
            relative_path: Relative path string
            task_json_path: Path to task.json file
        
        Returns:
            Resolved absolute Path
        """
        task_dir = task_json_path.parent
        return (task_dir / relative_path).resolve()
    
    @staticmethod
    def normalize_path(absolute_path: Path, task_json_path: Path) -> str:
        """
        Normalize absolute path to relative path from task.json.
        
        Args:
            absolute_path: Absolute path to file
            task_json_path: Path to task.json file
        
        Returns:
            Relative path string suitable for saving in JSON
        """
        try:
            task_dir = task_json_path.parent.resolve()
            absolute_resolved = absolute_path.resolve()
            
            # Try to make relative path
            try:
                relative = absolute_resolved.relative_to(task_dir)
                return str(relative).replace('\\', '/')
            except ValueError:
                # If not relative, return as absolute string
                return str(absolute_resolved)
        except Exception as e:
            logger.warning(f"Error normalizing path {absolute_path}: {e}")
            return str(absolute_path)



















































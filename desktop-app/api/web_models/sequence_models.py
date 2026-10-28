from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class WebSequenceElement(BaseModel):
    id: str = Field(..., description="Unique element ID (e.g. 'elem_1')")
    text: str = Field(..., description="Display text for the element")
    image: Optional[str] = Field(
        None,
        description="Optional image URL or path for the element",
    )


class WebSequenceLevel(BaseModel):
    level_id: str = Field(..., description="Unique level ID (e.g. 'level_1')")
    label: Optional[str] = Field(
        None,
        description="Human readable level label (e.g. 'Красный')",
    )
    slots: List[str] = Field(
        ..., min_items=1, description="Correct element IDs for this level (answer key)",
    )


class WebSequenceHierarchyNode(BaseModel):
    node_id: str = Field(..., description="Unique node ID (e.g. 'node_1')")
    level_id: str = Field(..., description="ID of the horizontal tier/level this node sits on")
    parent_id: Optional[str] = Field(
        None,
        description="Parent node ID on the preceding tier (None for root nodes)",
    )
    slots: List[str] = Field(
        default_factory=list,
        description="Correct element IDs for this node/group (answer key)",
    )
    column_title: Optional[str] = Field(
        None,
        description="Optional column header title for root nodes (e.g. 'Пневмоторакс')",
    )


class WebSequenceSettings(BaseModel):
    display_mode: str = Field(
        "linear",
        description="Visual & structural layout mode: 'linear' or 'hierarchy'",
    )
    color_differentiation: bool = Field(
        False,
        description="Whether auto-palette color differentiation is enabled",
    )
    level_order_matters: bool = Field(
        False,
        description="Whether the order of levels is important for evaluation",
    )
    sequence_within_level_matters: bool = Field(
        False,
        description="Whether the order of elements inside each level is important",
    )
    shuffle_elements: bool = Field(
        True,
        description="Whether available elements should be shuffled for display",
    )
    show_hints: bool = Field(
        False,
        description="Whether UI should show extra hints about sequence importance",
    )
    extra: Dict[str, Any] = Field(
        default_factory=dict,
        description="Extensible bag for future settings not yet modelled explicitly",
    )


class WebSequenceTaskData(BaseModel):
    """Web-facing representation of sequence_assembly task_data.

    This mirrors the underlying task.json structure but in a normalized form
    convenient for S1 web UI.
    """

    prompt: str = Field(..., description="Task instruction shown to the user")
    display_mode: str = Field(
        "linear",
        description="Visual & structural layout mode: 'linear' or 'hierarchy'",
    )
    color_differentiation: bool = Field(
        False,
        description="Whether auto-palette color differentiation is enabled",
    )
    elements: List[WebSequenceElement] = Field(
        ..., min_items=2, description="All available elements user can place",
    )
    levels: List[WebSequenceLevel] = Field(
        ..., min_items=1, description="Correct structure of levels and their elements",
    )
    nodes: Optional[List[WebSequenceHierarchyNode]] = Field(
        None,
        description="Hierarchy tree/table nodes when display_mode == 'hierarchy'",
    )
    settings: WebSequenceSettings = Field(
        default_factory=WebSequenceSettings,
        description="Behaviour flags for this task",
    )


class WebSequenceAnswerLevel(BaseModel):
    level_id: str = Field(..., description="ID of level where user placed elements")
    blocks: List[str] = Field(
        ..., description="Actual user order of element IDs in this level",
    )

    # difficulty >= 2
    level_name: Optional[str] = Field(
        None,
        description="Optional user-provided level name (difficulty >= 2)",
    )

    # difficulty == 3 (requires_block_names)
    block_names: Optional[Dict[str, str]] = Field(
        None,
        description="Optional mapping: element_id -> user-provided element name (difficulty == 3)",
    )


class WebSequenceAnswerNode(BaseModel):
    node_id: str = Field(..., description="ID of hierarchy node/group")
    level_id: Optional[str] = Field(
        None,
        description="ID of tier/level this node belongs to",
    )
    parent_id: Optional[str] = Field(
        None,
        description="Optional parent node ID",
    )
    blocks: List[str] = Field(
        default_factory=list,
        description="Actual user element IDs in this node/group",
    )
    block_names: Optional[Dict[str, str]] = Field(
        None,
        description="Optional mapping: slot_key/element_id -> user-provided element text (difficulty == 3)",
    )
    column_title: Optional[str] = Field(
        None,
        description="Optional column header title for root nodes",
    )


class WebSequenceAnswer(BaseModel):
    """User answer payload for sequence_assembly tasks.

    For web we expect the levels-based format (or nodes-based in hierarchy mode).
    The legacy flat "sequence" field is kept only for backward compatibility.
    """

    levels: List[WebSequenceAnswerLevel] = Field(
        default_factory=list,
        description="User layout of elements per level",
    )
    nodes: Optional[List[WebSequenceAnswerNode]] = Field(
        None,
        description="User layout of elements per hierarchy node/group",
    )
    display_mode: Optional[str] = Field(
        None,
        description="Optional display mode ('linear' | 'hierarchy')",
    )
    sequence: Optional[List[str]] = Field(
        None,
        description="Legacy flat sequence representation (unused by new web UI)",
    )


class WebSequenceIncorrectSequence(BaseModel):
    level: int = Field(..., description="1-based position of level in user answer")
    level_id: str = Field(..., description="ID of level")
    expected: List[str] = Field(..., description="Expected element order for this level")
    actual: List[str] = Field(..., description="Actual user element order for this level")


class WebSequenceResultDetails(BaseModel):
    """Typed view over details returned by SequenceAssemblyTaskEvaluator."""

    # NOTE: We support multiple result shapes:
    # - legacy evaluator details (user_levels/correct_levels/correct_blocks/...)
    # - newer TaskEvaluatorService details (correct_levels as list[str], incorrect_levels as list[str], etc.)
    # Keep fields optional and permissive so SessionAPI normalization never fails.

    user_levels: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="Raw user levels as seen by evaluator",
    )
    correct_levels: Optional[List[Union[Dict[str, Any], str]]] = Field(
        default=None, description="Reference levels from task answer key (dicts or level_id strings)",
    )
    correct_blocks: Optional[int] = Field(default=None, ge=0)
    total_blocks: Optional[int] = Field(default=None, ge=0)
    sequence_matters: Optional[bool] = None
    level_order_matters: Optional[bool] = None
    levels_in_correct_order: Optional[bool] = None
    incorrect_levels: Optional[List[Union[int, str]]] = Field(
        default_factory=list,
        description="Indices (legacy) or level_id strings of levels that contain errors",
    )
    incorrect_sequences: Optional[List[WebSequenceIncorrectSequence]] = Field(
        default_factory=list,
        description="Detailed info for levels where element order is wrong",
    )

    # Extra fields used by the newer web UI.
    level_names_map: Optional[Dict[str, Any]] = None
    evaluator_result: Optional[Dict[str, Any]] = None
    total_levels: Optional[int] = None
    sequence_success: Optional[bool] = None
    levels_order_correct: Optional[bool] = None
    correct_blocks_by_level: Optional[Dict[str, Any]] = None
    level: Optional[int] = None
    level_names: Optional[Dict[str, Any]] = None
    block_names: Optional[Dict[str, Any]] = None
    correct_levels_data: Optional[List[Dict[str, Any]]] = None
    user_levels_data: Optional[List[Dict[str, Any]]] = None
    elements_data: Optional[List[Dict[str, Any]]] = None
    names_correct_but_blocks_empty: Optional[List[str]] = None

    # Hierarchy mode result fields
    display_mode: Optional[str] = None
    correct_nodes: Optional[List[str]] = None
    incorrect_nodes: Optional[List[str]] = None
    correct_blocks_by_node: Optional[Dict[str, Any]] = None
    node_mapping: Optional[Dict[str, str]] = None
    correct_nodes_data: Optional[List[Dict[str, Any]]] = None
    user_nodes_data: Optional[List[Dict[str, Any]]] = None
    message_key: Optional[str] = None
    message_params: Optional[Dict[str, Any]] = None

    task_type: Optional[str] = Field(
        None,
        description="Redundant marker preserved for compatibility with existing details",
    )

    model_config = {
        "extra": "allow",
    }

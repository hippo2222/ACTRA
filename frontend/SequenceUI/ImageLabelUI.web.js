/**
 * ACTRA Image Labeling Player UI
 */

const ImageLabelUI = (function () {
    let currentInstance = null;

    function createRoot(container, task) {
        const taskData = (task && (task.task_data || task.content || task.task || task)) || {};
        const content = taskData.content || (task && task.content) || {};
        const zones = content.zones || [];
        
        const settings = {
            ...((task && task.settings && typeof task.settings === 'object') ? task.settings : {}),
            ...((taskData.settings && typeof taskData.settings === 'object') ? taskData.settings : {}),
            ...((content.settings && typeof content.settings === 'object') ? content.settings : {})
        };
        
        let rawDifficulty = null;
        if (task && task.difficulty !== undefined && task.difficulty !== null) {
            rawDifficulty = task.difficulty;
        } else if (task && task._difficulty_level !== undefined && task._difficulty_level !== null) {
            rawDifficulty = task._difficulty_level;
        } else if (taskData && taskData._difficulty_level !== undefined && taskData._difficulty_level !== null) {
            rawDifficulty = taskData._difficulty_level;
        } else if (taskData && taskData.difficulty !== undefined && taskData.difficulty !== null) {
            rawDifficulty = taskData.difficulty;
        } else if (settings.difficulty_level !== undefined && settings.difficulty_level !== null) {
            rawDifficulty = settings.difficulty_level;
        } else if (settings.difficulty !== undefined && settings.difficulty !== null) {
            rawDifficulty = settings.difficulty;
        }
        const difficulty = Number(rawDifficulty || 1);

        // Current student assignments: mapping zoneId -> labelText
        let assignments = {}; 
        let lastCheckResult = null;
        
        // Tracking click-to-assign state (Difficulty 1)
        let selectedLabelId = null;
        let selectedZoneId = null;

        function selectLabelCard(card) {
            if (!card) return;
            card.style.borderColor = 'var(--color-primary, #6366f1)';
            card.style.borderWidth = '2px';
            card.style.backgroundColor = 'color-mix(in srgb, var(--color-primary, #6366f1) 14%, var(--color-surface-2, #f1f5f9))';
            card.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--color-primary, #6366f1) 30%, transparent), 0 4px 12px rgba(99, 102, 241, 0.2)';
            card.style.transform = 'translateY(-2px) scale(1.02)';
            
            const icon = card.querySelector('.drag-handle');
            if (icon) {
                icon.textContent = 'check_circle';
                icon.style.color = 'var(--color-primary, #6366f1)';
            }
        }

        function unselectLabelCard(card) {
            if (!card) return;
            card.style.borderColor = '';
            card.style.borderWidth = '';
            card.style.backgroundColor = '';
            card.style.boxShadow = '';
            card.style.transform = '';
            
            const icon = card.querySelector('.drag-handle');
            if (icon) {
                icon.textContent = 'drag_indicator';
                icon.style.color = '';
            }
        }

        function selectZoneOverlay(overlay) {
            if (!overlay) return;
            overlay.style.borderColor = 'var(--color-primary, #6366f1)';
            overlay.style.borderWidth = '2px';
            overlay.style.borderStyle = 'dashed';
            overlay.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--color-primary, #6366f1) 35%, transparent), 0 8px 24px rgba(99, 102, 241, 0.3)';
            overlay.style.transform = 'scale(1.03)';
            overlay.style.zIndex = '20';
        }

        function unselectZoneOverlay(overlay, zoneDef) {
            if (!overlay) return;
            const baseColor = (zoneDef && zoneDef.color) || '#ffffff';
            overlay.style.borderColor = baseColor === '#ffffff' ? '#cbd5e1' : baseColor;
            overlay.style.borderWidth = '1px';
            overlay.style.borderStyle = 'solid';
            overlay.style.boxShadow = 'none';
            overlay.style.transform = '';
            overlay.style.zIndex = '';
        }

        // Inject Emil Kowalski Motion Tokens and Micro-interaction Styles
        (function injectAnimationStyles() {
            if (document.getElementById('image-labeling-animation-styles')) return;
            const style = document.createElement('style');
            style.id = 'image-labeling-animation-styles';
            style.textContent = `
                .label-card-item {
                    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 120ms cubic-bezier(0.23, 1, 0.32, 1), border-color 120ms ease;
                }
                .label-card-item:active {
                    transform: scale(0.97) !important;
                }
                .player-zone-overlay {
                    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease, transform 140ms ease;
                }
                .player-zone-input::placeholder {
                    color: var(--color-text-secondary, #94a3b8) !important;
                    opacity: 0.65;
                    font-weight: 400;
                }
                .player-zone-input {
                    caret-color: var(--color-primary, #6366f1);
                    font-family: inherit;
                    transition: color 140ms ease;
                }
            `;
            document.head.appendChild(style);
        })();

        // FLIP Animations for fluid spatial movement (transitions-dev motion tokens)
        // 1. Placement (Fly from origin card / mouse drop point into target zone)
        function animateFLIPPlacement(fromOrigin, targetOverlay) {
            if (!targetOverlay) return;
            const badge = targetOverlay.querySelector('span');
            if (!badge) return;

            let fromRect = null;
            if (fromOrigin && typeof fromOrigin.getBoundingClientRect === 'function') {
                fromRect = fromOrigin.getBoundingClientRect();
            } else if (fromOrigin && typeof fromOrigin.left === 'number') {
                fromRect = fromOrigin;
            }
            if (!fromRect || !fromRect.width) return;

            const toRect = badge.getBoundingClientRect();
            if (!toRect.width || !toRect.height) return;

            const deltaX = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
            const deltaY = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
            const scaleX = Math.max(0.3, Math.min(2.5, fromRect.width / toRect.width));
            const scaleY = Math.max(0.3, Math.min(2.5, fromRect.height / toRect.height));

            // Animate badge directly using Web Animations API (zero ghost DOM, zero double text)
            badge.animate([
                {
                    transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
                    opacity: 0.85,
                    boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)'
                },
                {
                    transform: 'translate3d(0, 0, 0) scale(1, 1)',
                    opacity: 1,
                    boxShadow: 'none'
                }
            ], {
                duration: 220,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            // Target zone glow feedback
            targetOverlay.animate([
                { boxShadow: '0 0 0 0px var(--color-primary, #6366f1)' },
                { boxShadow: '0 0 0 6px color-mix(in srgb, var(--color-primary, #6366f1) 40%, transparent)', offset: 0.5 },
                { boxShadow: '0 0 0 0px transparent' }
            ], {
                duration: 220,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });
        }

        // 2. Return (Fly from zone plate back to sidebar card slot)
        function animateFLIPReturn(fromZoneOverlay, targetSideCard) {
            if (!targetSideCard) {
                syncSidebarPoolWithAssignments();
                return;
            }

            // Always reveal target card immediately in DOM state
            targetSideCard.classList.remove('opacity-30', 'pointer-events-none', 'hidden');

            let fromRect = null;
            if (fromZoneOverlay && typeof fromZoneOverlay.getBoundingClientRect === 'function') {
                const badge = fromZoneOverlay.querySelector('span');
                fromRect = (badge || fromZoneOverlay).getBoundingClientRect();
            }

            if (fromRect && fromRect.width) {
                const toRect = targetSideCard.getBoundingClientRect();
                if (toRect && toRect.width && toRect.height) {
                    const deltaX = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
                    const deltaY = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
                    const scaleX = Math.max(0.3, Math.min(2.0, fromRect.width / toRect.width));
                    const scaleY = Math.max(0.3, Math.min(2.0, fromRect.height / toRect.height));

                    targetSideCard.animate([
                        {
                            transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
                            opacity: 0.9,
                            borderColor: 'var(--color-primary, #6366f1)'
                        },
                        {
                            transform: 'translate3d(0, 0, 0) scale(1, 1)',
                            opacity: 1,
                            borderColor: ''
                        }
                    ], {
                        duration: 220,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                    });
                }
            }

            syncSidebarPoolWithAssignments();
        }

        function syncSidebarPoolWithAssignments() {
            if (!sidebar) return;
            const assignedValues = Object.values(assignments);
            const pool = sidebar.querySelector('#labels-pool');
            if (!pool) return;

            const cards = pool.querySelectorAll('[data-label-val]');
            cards.forEach(card => {
                const val = card.getAttribute('data-label-val');
                if (assignedValues.includes(val)) {
                    card.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                } else {
                    card.classList.remove('opacity-30', 'pointer-events-none', 'hidden');
                }
            });
        }

        // 3. Custom 60fps Pointer Drag System (No white corners, real DOM floating pill, smooth cursor tracking)
        function setupPointerDrag(triggerEl, getDragConfig) {
            triggerEl.addEventListener('pointerdown', (startEvt) => {
                if (isReadOnly) return;
                if (startEvt.button !== 0 && startEvt.pointerType === 'mouse') return;

                const config = getDragConfig();
                if (!config || !config.labelText) return;

                const startX = startEvt.clientX;
                const startY = startEvt.clientY;
                let isDragging = false;
                let dragAvatar = null;
                let hoveredZoneOverlay = null;

                function onPointerMove(moveEvt) {
                    const dx = moveEvt.clientX - startX;
                    const dy = moveEvt.clientY - startY;

                    // Start drag threshold (> 4px)
                    if (!isDragging && Math.hypot(dx, dy) > 4) {
                        isDragging = true;

                        // Create sleek floating badge pill with rich indigo background
                        dragAvatar = document.createElement('div');
                        dragAvatar.className = 'fixed z-[999999] pointer-events-none flex items-center justify-center font-bold text-xs px-3.5 py-2 select-none';
                        dragAvatar.style.borderRadius = '10px';
                        dragAvatar.style.backgroundColor = config.bgColor || 'var(--color-primary, #6366f1)';
                        dragAvatar.style.color = config.textColor || '#ffffff';
                        dragAvatar.style.border = '1px solid rgba(255, 255, 255, 0.35)';
                        dragAvatar.style.boxShadow = '0 12px 28px -4px rgba(99, 102, 241, 0.55), 0 8px 10px -6px rgba(0, 0, 0, 0.3)';
                        dragAvatar.style.backdropFilter = 'blur(12px)';
                        dragAvatar.style.top = '0px';
                        dragAvatar.style.left = '0px';
                        dragAvatar.style.willChange = 'transform';
                        dragAvatar.textContent = config.labelText;
                        document.body.appendChild(dragAvatar);

                        // Dim origin element (except for zone overlays which must stay 100% opaque to mask background image text)
                        if (config.originElement) {
                            if (config.originElement.classList.contains('player-zone-overlay')) {
                                config.originElement.style.opacity = '1';
                            } else {
                                config.originElement.style.opacity = '0.25';
                            }
                            config.originElement.style.transform = 'scale(0.96)';
                        }
                    }

                    if (isDragging && dragAvatar) {
                        // Move drag avatar smoothly centered under cursor
                        const w = dragAvatar.offsetWidth || 90;
                        const h = dragAvatar.offsetHeight || 32;
                        dragAvatar.style.transform = `translate3d(${moveEvt.clientX - w / 2}px, ${moveEvt.clientY - h / 2}px, 0) scale(1.06) rotate(1.5deg)`;

                        // Highlight hovered zone under cursor
                        const targetUnderCursor = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
                        const zoneOverlay = targetUnderCursor ? targetUnderCursor.closest('.player-zone-overlay') : null;

                        if (hoveredZoneOverlay && hoveredZoneOverlay !== zoneOverlay) {
                            hoveredZoneOverlay.style.boxShadow = 'none';
                            hoveredZoneOverlay = null;
                        }
                        if (zoneOverlay && zoneOverlay !== hoveredZoneOverlay) {
                            hoveredZoneOverlay = zoneOverlay;
                            hoveredZoneOverlay.style.boxShadow = '0 0 0 4px var(--color-primary, #6366f1)';
                        }
                    }
                }

                function onPointerUp(upEvt) {
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);

                    if (hoveredZoneOverlay) {
                        hoveredZoneOverlay.style.boxShadow = 'none';
                    }

                    if (isDragging && dragAvatar) {
                        const dropX = upEvt.clientX;
                        const dropY = upEvt.clientY;
                        dragAvatar.remove();

                        const dropTarget = document.elementFromPoint(dropX, dropY);
                        const targetZoneOverlay = dropTarget ? dropTarget.closest('.player-zone-overlay') : null;

                        if (targetZoneOverlay && typeof config.onDrop === 'function') {
                            config.onDrop(targetZoneOverlay, { left: dropX - 45, top: dropY - 16, width: 90, height: 32 });
                        } else {
                            // Cancelled / Dropped in invalid spot -> restore origin
                            if (config.originElement) {
                                config.originElement.style.opacity = '';
                                config.originElement.style.transform = '';
                            }
                        }
                    }
                }

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            });
        }

        // Image size caches
        let imgW = 0;
        let imgH = 0;

        // Interactive states
        let isReadOnly = false;
        let zoomLevel = 1.0;
        let panX = 0;
        let panY = 0;
        let isPanning = false;
        let panStart = { x: 0, y: 0 };

        // Shuffled pool of labels (Difficulty 1)
        let shuffledLabels = [];
        
        if (difficulty === 1) {
            shuffledLabels = zones.map(z => ({
                id: z.id,
                label: z.label
            }));
            // Shuffle
            shuffledLabels.sort(() => Math.random() - 0.5);
        }

        // Setup base layout
        container.innerHTML = '';
        container.className = 'w-full flex overflow-hidden bg-bg-main relative select-none';
        container.style.height = 'calc(100vh - 180px)';
        container.style.minHeight = '520px';
        container.style.borderRadius = '1.5rem';
        container.style.border = '1px solid var(--color-border-subtle, #e2e8f0)';

        // 1. Central Image Area
        const workspace = document.createElement('div');
        workspace.className = 'flex-1 h-full overflow-hidden relative flex items-center justify-center';
        workspace.id = 'player-workspace';

        const viewport = document.createElement('div');
        viewport.className = 'absolute inset-0 overflow-hidden flex items-center justify-center';
        viewport.id = 'player-viewport';

        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'relative origin-center';
        canvasContainer.id = 'player-canvas-container';
        canvasContainer.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)';

        const img = document.createElement('img');
        img.className = 'pointer-events-none select-none max-w-none max-h-none block';
        img.id = 'player-main-image';
        
        // Resolve image URL
        let imageSrc = '';
        const rawImg = content.image;
        if (rawImg) {
            if (typeof rawImg === 'object') {
                imageSrc = rawImg.asset_url || (rawImg.asset_id ? `/api/assets/${encodeURIComponent(String(rawImg.asset_id))}/content` : rawImg.path);
            } else {
                imageSrc = rawImg;
            }
            if (imageSrc && !/^(https?:|data:|\/)/i.test(imageSrc)) {
                imageSrc = `/api/local-image?path=${encodeURIComponent(imageSrc)}`;
            }
        }

        canvasContainer.appendChild(img);
        viewport.appendChild(canvasContainer);
        workspace.appendChild(viewport);
        container.appendChild(workspace);

        // 2. Zoom Controls UI
        const zoomControls = document.createElement('div');
        zoomControls.className = 'absolute flex flex-col items-center gap-2.5 bg-surface-1 border border-border-subtle px-2.5 py-4 rounded-full shadow-lg z-10 select-none text-text-secondary';
        zoomControls.style.left = '24px';
        zoomControls.style.top = '50%';
        zoomControls.style.transform = 'translateY(-50%)';
        zoomControls.innerHTML = `
            <button id="p-zoom-in" title="Увеличить" class="p-1 hover:text-text-main transition-colors flex items-center justify-center">
                <span class="material-symbols-outlined text-[20px]">zoom_in</span>
            </button>
            <span id="p-zoom-value" class="text-[10px] font-bold select-none min-w-[32px] text-center tracking-tighter">100%</span>
            <button id="p-zoom-out" title="Уменьшить" class="p-1 hover:text-text-main transition-colors flex items-center justify-center">
                <span class="material-symbols-outlined text-[20px]">zoom_out</span>
            </button>
            <div class="w-3.5 h-px bg-border-subtle my-1"></div>
            <button id="p-zoom-reset" title="Вписать" class="p-1 hover:text-text-main transition-colors flex items-center justify-center">
                <span class="material-symbols-outlined text-[20px]">fullscreen_exit</span>
            </button>
        `;
        workspace.appendChild(zoomControls);

        // 3. Right Sidebar (Only for Difficulty 1)
        let sidebar = null;
        if (difficulty === 1) {
            sidebar = document.createElement('aside');
            sidebar.className = 'w-[320px] bg-surface-1 border-l border-border-subtle flex flex-col shrink-0 h-full z-10';
            sidebar.innerHTML = `
                <div class="h-14 flex items-center px-6 border-b border-border-subtle shrink-0">
                    <h3 class="text-text-main font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <span class="material-symbols-outlined text-text-disabled">list</span>
                        <span>Доступные элементы</span>
                    </h3>
                </div>
                <div id="labels-pool" class="flex-1 p-6 space-y-3 overflow-y-auto custom-scrollbar">
                    <!-- Shuffled plates will render here -->
                </div>
            `;
            container.appendChild(sidebar);
        }

        let imageReadyCalled = false;
        function onImageReady() {
            if (imageReadyCalled) return;
            imageReadyCalled = true;
            imgW = img.naturalWidth || img.clientWidth || 800;
            imgH = img.naturalHeight || img.clientHeight || 600;
            canvasContainer.style.width = `${imgW}px`;
            canvasContainer.style.height = `${imgH}px`;
            
            resetZoom();
            renderInteractiveZones();
            if (difficulty === 1) {
                renderLabelsPool();
            }
        }

        img.onload = onImageReady;
        img.src = imageSrc;

        if (img.complete && img.naturalWidth) {
            // Trigger immediately if cached / pre-loaded
            onImageReady();
        }

        // Zoom & Pan transforms helper
        function updateTransform() {
            canvasContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
            const valDisplay = zoomControls.querySelector('#p-zoom-value');
            if (valDisplay) {
                valDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
            }
        }

        function resetZoom() {
            if (!imgW) return;
            const viewW = viewport.clientWidth;
            const viewH = viewport.clientHeight;
            const scaleX = (viewW - 32) / imgW;
            const scaleY = (viewH - 32) / imgH;
            
            zoomLevel = Math.min(1.0, scaleX, scaleY);
            panX = 0;
            panY = 0;
            updateTransform();
        }

        function adjustZoom(delta, focal = null) {
            const before = zoomLevel;
            zoomLevel = Math.max(0.1, Math.min(6.0, zoomLevel + delta));
            if (Math.abs(before - zoomLevel) < 0.0001) return;

            if (!focal) {
                focal = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
            }

            const worldX = (focal.x - panX) / before;
            const worldY = (focal.y - panY) / before;
            panX = focal.x - worldX * zoomLevel;
            panY = focal.y - worldY * zoomLevel;

            updateTransform();
        }

        // Pan/zoom interaction listeners
        zoomControls.querySelector('#p-zoom-in').addEventListener('click', () => adjustZoom(0.15));
        zoomControls.querySelector('#p-zoom-out').addEventListener('click', () => adjustZoom(-0.15));
        zoomControls.querySelector('#p-zoom-reset').addEventListener('click', () => resetZoom());

        viewport.addEventListener('mousedown', (e) => {
            // Middle-click, right-click or Shift-drag to pan
            if (e.button === 1 || e.button === 2 || e.shiftKey) {
                e.preventDefault();
                isPanning = true;
                panStart = { x: e.clientX, y: e.clientY };
            }
        });

        viewport.addEventListener('contextmenu', (e) => e.preventDefault());

        workspace.addEventListener('click', (e) => {
            if (!e.target.closest('.player-zone-overlay') && !e.target.closest('[data-label-id]')) {
                if (selectedLabelId && sidebar) {
                    const prevCard = sidebar.querySelector(`[data-label-id="${selectedLabelId}"]`);
                    unselectLabelCard(prevCard);
                    selectedLabelId = null;
                }
                if (selectedZoneId) {
                    const prevZone = canvasContainer.querySelector(`[data-zone-id="${selectedZoneId}"]`);
                    const prevZ = zones.find(z => z.id === selectedZoneId);
                    unselectZoneOverlay(prevZone, prevZ);
                    selectedZoneId = null;
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isPanning) {
                panX += e.clientX - panStart.x;
                panY += e.clientY - panStart.y;
                panStart = { x: e.clientX, y: e.clientY };
                updateTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            isPanning = false;
        });

        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvasContainer.getBoundingClientRect();
            const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            adjustZoom(delta, focal);
        }, { passive: false });

        window.addEventListener('resize', onResize);

        function onResize() {
            // Recalculate bounds and center on window resize
            if (imgW) {
                canvasContainer.style.width = `${imgW}px`;
                canvasContainer.style.height = `${imgH}px`;
                resetZoom();
            }
        }

        // Render targets overlayed absolutely on top of the canvasContainer
        // Dynamic CSS injection for placeholder/overlay styling in student view
        if (!document.getElementById('image-labeling-player-styles')) {
            const style = document.createElement('style');
            style.id = 'image-labeling-player-styles';
            style.innerHTML = `
                .player-zone-input::placeholder {
                    color: #94a3b8 !important;
                    opacity: 0.7;
                }
                .player-zone-overlay {
                    box-sizing: border-box;
                    white-space: normal;
                    word-break: break-word;
                    overflow: visible;
                }
            `;
            document.head.appendChild(style);
        }

        // Contrast helper
        function getContrastColor(hexColor) {
            if (!hexColor || hexColor.toLowerCase() === '#ffffff') return '#0f172a';
            const hex = hexColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            if (isNaN(r) || isNaN(g) || isNaN(b)) return '#0f172a';
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#0f172a' : '#ffffff';
        }

        function updateLvl2Progress() {
            if (difficulty !== 2 || !sidebar) return;
            const filledCount = Object.keys(assignments).filter(k => assignments[k] && String(assignments[k]).trim() !== '').length;
            const total = zones.length;
            const pct = total > 0 ? Math.round((filledCount / total) * 100) : 0;
            
            const counterEl = sidebar.querySelector('#lvl2-progress-counter');
            const barEl = sidebar.querySelector('#lvl2-progress-bar');
            const zonesListEl = sidebar.querySelector('#lvl2-zones-list');

            if (counterEl) counterEl.textContent = `${filledCount} из ${total}`;
            if (barEl) barEl.style.width = `${pct}%`;

            if (zonesListEl) {
                zonesListEl.innerHTML = '';
                zones.forEach((z, i) => {
                    const val = (assignments[z.id] || '').trim();
                    const isFilled = val.length > 0;
                    const displayText = isFilled ? val : 'Область ' + (i + 1);
                    
                    const card = document.createElement('div');
                    card.className = `p-2.5 rounded-xl border text-xs transition-all flex items-center justify-between gap-2 cursor-pointer ${
                        isFilled
                            ? 'bg-primary/5 border-primary/30 text-text-main hover:bg-primary/10'
                            : 'bg-surface-2/40 hover:bg-surface-2 border-border-subtle text-text-secondary'
                    }`;
                    card.setAttribute('title', displayText);
                    card.innerHTML = `
                        <div class="flex items-center gap-2 min-w-0 flex-1">
                            <span class="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                                isFilled ? 'bg-primary text-white' : 'bg-surface-3 text-text-secondary'
                            }">${i + 1}</span>
                            <span class="truncate font-medium flex-1 ${isFilled ? 'text-primary-dark font-semibold' : 'text-text-secondary'}">${displayText}</span>
                        </div>
                        <span class="material-symbols-outlined text-[16px] shrink-0 ${
                            isFilled ? 'text-primary' : 'text-text-disabled'
                        }">${isFilled ? 'check_circle' : 'edit_square'}</span>
                    `;
                    card.addEventListener('click', () => {
                        const targetInput = canvasContainer.querySelector(`[data-zone-input-index="${i}"]`);
                        if (targetInput) {
                            targetInput.focus();
                        }
                    });
                    zonesListEl.appendChild(card);
                });
            }
        }

        function renderInteractiveZones() {
            // Clear previous zones elements
            canvasContainer.querySelectorAll('.player-zone-overlay').forEach(el => el.remove());

            zones.forEach((zone, idx) => {
                const overlay = document.createElement('div');
                overlay.className = 'player-zone-overlay absolute border rounded-md flex items-center justify-center transition-all box-border';
                overlay.style.left = `${zone.rect.x}%`;
                overlay.style.top = `${zone.rect.y}%`;
                
                // Allow dynamic scaling
                overlay.style.minWidth = `${zone.rect.width}%`;
                overlay.style.minHeight = `${zone.rect.height}%`;
                overlay.style.width = 'auto';
                overlay.style.height = 'auto';
                
                const baseColor = zone.color || '#ffffff';
                overlay.style.borderColor = baseColor === '#ffffff' ? '#cbd5e1' : baseColor;
                overlay.style.backgroundColor = '#ffffff';
                overlay.style.opacity = '1';
                overlay.style.overflow = 'visible';
                overlay.setAttribute('data-zone-id', zone.id);

                if (difficulty === 1) {
                    // Complexity 1: Match from pool (Drag and drop / Click targets)
                    overlay.classList.add('cursor-pointer');
                    
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'text-center font-bold px-2 py-1 max-w-full';
                    
                    const baseHeightPx = (zone.rect.height / 100) * imgH;

                    updateOverlayTextPlate();
                    overlay.updatePlate = updateOverlayTextPlate;

                    function updateOverlayTextPlate() {
                        const assigned = assignments[zone.id];
                        const textLength = (assigned || '?').length;
                        
                        let scaleFactor = 0.75;
                        if (textLength > 15) scaleFactor = 0.55;
                        if (textLength > 30) scaleFactor = 0.45;

                        const fs = Math.max(12, Math.min(32, baseHeightPx * scaleFactor));
                        labelSpan.style.fontSize = `${fs}px`;
                        labelSpan.style.lineHeight = '1.1';
                        labelSpan.style.whiteSpace = 'normal';
                        labelSpan.style.wordBreak = 'break-word';

                        if (assigned) {
                            overlay.style.backgroundColor = 'var(--color-primary, #6366f1)';
                            overlay.style.borderColor = 'var(--color-primary-dark, #4f46e5)';
                            overlay.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.35)';
                            labelSpan.textContent = assigned;
                            labelSpan.style.color = '#ffffff';
                            labelSpan.style.backgroundColor = 'transparent';
                            labelSpan.style.padding = '0.25em 0.6em';
                        } else {
                            overlay.style.backgroundColor = '#ffffff';
                            overlay.style.borderColor = '#cbd5e1';
                            overlay.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.08)';
                            labelSpan.textContent = '?';
                            labelSpan.style.color = 'var(--color-text-secondary, #64748b)';
                            labelSpan.style.backgroundColor = 'transparent';
                            labelSpan.style.padding = '0.25em 0.6em';
                        }
                    }

                    overlay.appendChild(labelSpan);

                    // Prevent native HTML5 DnD ghost screenshot
                    overlay.addEventListener('dragstart', (e) => e.preventDefault());

                    // Custom 60fps Pointer Drag for Zone Overlay
                    setupPointerDrag(overlay, () => {
                        const assigned = assignments[zone.id];
                        if (!assigned) return null;

                        return {
                            labelText: assigned,
                            originElement: overlay,
                            onDrop: (targetZoneOverlay, dropRect) => {
                                overlay.style.opacity = '1';
                                overlay.style.transform = '';

                                const targetZoneId = targetZoneOverlay.getAttribute('data-zone-id');
                                if (!targetZoneId || targetZoneId === zone.id) return;

                                const oldAssigned = assignments[targetZoneId];
                                assignments[targetZoneId] = assigned;

                                if (oldAssigned) {
                                    assignments[zone.id] = oldAssigned;
                                } else {
                                    delete assignments[zone.id];
                                }

                                if (typeof overlay.updatePlate === 'function') overlay.updatePlate();
                                if (typeof targetZoneOverlay.updatePlate === 'function') targetZoneOverlay.updatePlate();

                                animateFLIPPlacement(dropRect, targetZoneOverlay);
                                if (oldAssigned) {
                                    animateFLIPPlacement(targetZoneOverlay, overlay);
                                }
                            }
                        };
                    });

                    // Click to assign interactions
                    overlay.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isReadOnly) return;
                        
                        // Clear validation error state if any
                        overlay.style.boxShadow = 'none';

                        // If zone has assignment, return it back to sidebar
                        if (assignments[zone.id]) {
                            const returnedVal = assignments[zone.id];
                            const sideCard = sidebar ? sidebar.querySelector(`[data-label-val="${returnedVal.replace(/"/g, '&quot;')}"]`) : null;

                            delete assignments[zone.id];
                            updateOverlayTextPlate();

                            if (sideCard) {
                                unselectLabelCard(sideCard);
                                animateFLIPReturn(overlay, sideCard);
                            }
                            return;
                        }

                        // Bidirectional Click placement
                        if (selectedLabelId !== null) {
                            // Assign
                            const labelCard = sidebar.querySelector(`[data-label-id="${selectedLabelId}"]`);
                            if (labelCard) {
                                const val = labelCard.getAttribute('data-label-val');
                                assignments[zone.id] = val;
                                updateOverlayTextPlate();
                                animateFLIPPlacement(labelCard, overlay);

                                // Disable card in sidebar
                                labelCard.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                                unselectLabelCard(labelCard);
                                selectedLabelId = null;
                            }
                        } else {
                            // Zone first click
                            if (selectedZoneId === zone.id) {
                                selectedZoneId = null;
                                unselectZoneOverlay(overlay, zone);
                            } else {
                                if (selectedZoneId) {
                                    const prevZone = canvasContainer.querySelector(`[data-zone-id="${selectedZoneId}"]`);
                                    if (prevZone) {
                                        const prevZ = zones.find(z => z.id === selectedZoneId);
                                        unselectZoneOverlay(prevZone, prevZ);
                                    }
                                }
                                selectedZoneId = zone.id;
                                selectZoneOverlay(overlay);
                            }
                        }
                    });

                    // HTML5 Drag over support
                    overlay.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        overlay.style.boxShadow = '0 0 0 3px var(--color-primary, #6366f1)';
                    });

                    overlay.addEventListener('dragleave', () => {
                        overlay.style.boxShadow = 'none';
                    });

                    overlay.addEventListener('drop', (e) => {
                        e.preventDefault();
                        overlay.style.boxShadow = 'none';
                        const val = e.dataTransfer.getData('text/plain');
                        const sourceLabelId = e.dataTransfer.getData('source-id');
                        const dropPointRect = {
                            left: e.clientX - 45,
                            top: e.clientY - 16,
                            width: 90,
                            height: 32
                        };
                        
                        if (val && sourceLabelId) {
                            if (sourceLabelId.startsWith('zone-')) {
                                const sourceZoneId = sourceLabelId.substring(5);
                                if (sourceZoneId === zone.id) return; // Dropped on itself

                                const sourceOverlay = canvasContainer.querySelector(`[data-zone-id="${sourceZoneId}"]`);
                                const oldAssigned = assignments[zone.id];
                                
                                // Perform swap
                                assignments[zone.id] = val;
                                updateOverlayTextPlate();
                                animateFLIPPlacement(sourceOverlay || dropPointRect, overlay);

                                if (oldAssigned) {
                                    assignments[sourceZoneId] = oldAssigned;
                                } else {
                                    delete assignments[sourceZoneId];
                                }

                                const sourceOverlayRefreshed = canvasContainer.querySelector(`[data-zone-id="${sourceZoneId}"]`);
                                if (sourceOverlayRefreshed && typeof sourceOverlayRefreshed.updatePlate === 'function') {
                                    sourceOverlayRefreshed.updatePlate();
                                    if (oldAssigned) {
                                        animateFLIPPlacement(overlay, sourceOverlayRefreshed);
                                    }
                                }
                            } else {
                                // Dropped from sidebar
                                const labelCard = sidebar.querySelector(`[data-label-id="${sourceLabelId}"]`);
                                const oldAssigned = assignments[zone.id];
                                if (oldAssigned) {
                                    const sideCard = sidebar.querySelector(`[data-label-val="${oldAssigned.replace(/"/g, '&quot;')}"]`);
                                    if (sideCard) {
                                        animateFLIPReturn(overlay, sideCard);
                                    }
                                }

                                assignments[zone.id] = val;
                                updateOverlayTextPlate();
                                animateFLIPPlacement(labelCard || dropPointRect, overlay);

                                if (labelCard) {
                                    labelCard.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                                    labelCard.classList.remove('border-primary', 'bg-primary/10');
                                }
                            }
                        }
                    });

                } else {
                    // Complexity 2: Direct keyboard typing input
                    overlay.classList.add('rounded-lg');
                    overlay.style.backgroundColor = '#ffffff';
                    overlay.style.opacity = '1';

                    // Empty icon indicator (replaces text "Название...")
                    const emptyIcon = document.createElement('span');
                    emptyIcon.className = 'lvl2-empty-icon material-symbols-outlined text-[16px] pointer-events-none select-none transition-all';
                    emptyIcon.textContent = 'edit_note';
                    overlay.appendChild(emptyIcon);

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = '';
                    input.setAttribute('autocomplete', 'off');
                    input.setAttribute('spellcheck', 'false');
                    input.setAttribute('data-zone-input-index', idx);
                    input.className = 'player-zone-input text-center border-0 font-semibold focus:ring-0 focus:outline-none bg-transparent px-1.5 leading-tight tracking-tight z-10';

                    const baseHeightPx = (zone.rect.height / 100) * imgH;
                    const fs = Math.max(12, Math.min(32, baseHeightPx * 0.72));
                    input.style.fontSize = `${fs}px`;

                    let isHovered = false;

                    function updateOverlayStyle(isFocused = false) {
                        if (lastCheckResult) return; // Don't override check result feedback styling
                        const val = (assignments[zone.id] || '').trim();
                        const isFilled = val.length > 0;

                        if (isFilled || isFocused) {
                            emptyIcon.style.display = 'none';
                        } else {
                            emptyIcon.style.display = '';
                            emptyIcon.style.color = (isHovered || isFocused) ? 'var(--color-primary, #6366f1)' : '#94a3b8';
                        }

                        if (isFocused) {
                            overlay.style.backgroundColor = '#ffffff';
                            overlay.style.borderColor = 'var(--color-primary, #6366f1)';
                            overlay.style.borderStyle = 'solid';
                            overlay.style.borderWidth = '2px';
                            overlay.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--color-primary, #6366f1) 28%, transparent), 0 8px 24px rgba(99, 102, 241, 0.25)';
                            overlay.style.transform = 'scale(1.04) translateY(-1px)';
                            overlay.style.zIndex = '30';
                            input.style.color = 'var(--color-text-main, #0f172a)';
                        } else if (isFilled) {
                            overlay.style.backgroundColor = 'color-mix(in srgb, var(--color-primary, #6366f1) 8%, #ffffff)';
                            overlay.style.borderColor = 'var(--color-primary, #6366f1)';
                            overlay.style.borderStyle = 'solid';
                            overlay.style.borderWidth = '1.5px';
                            overlay.style.boxShadow = '0 2px 10px color-mix(in srgb, var(--color-primary, #6366f1) 22%, transparent)';
                            overlay.style.transform = isHovered ? 'scale(1.02) translateY(-1px)' : '';
                            overlay.style.zIndex = '10';
                            input.style.color = 'var(--color-primary-dark, #4f46e5)';
                        } else {
                            overlay.style.backgroundColor = '#ffffff';
                            overlay.style.borderColor = isHovered ? 'var(--color-primary, #6366f1)' : 'var(--color-primary-light, #818cf8)';
                            overlay.style.borderStyle = isHovered ? 'solid' : 'dashed';
                            overlay.style.borderWidth = '1.5px';
                            overlay.style.boxShadow = isHovered
                                ? '0 4px 14px rgba(99, 102, 241, 0.25), 0 0 0 1px var(--color-primary, #6366f1)'
                                : '0 2px 8px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(99, 102, 241, 0.25)';
                            overlay.style.transform = isHovered ? 'scale(1.02) translateY(-1px)' : '';
                            overlay.style.zIndex = isHovered ? '20' : '';
                            input.style.color = 'var(--color-text-main, #0f172a)';
                        }
                    }

                    overlay.addEventListener('mouseenter', () => {
                        if (isReadOnly) return;
                        isHovered = true;
                        if (document.activeElement !== input) updateOverlayStyle(false);
                    });

                    overlay.addEventListener('mouseleave', () => {
                        if (isReadOnly) return;
                        isHovered = false;
                        if (document.activeElement !== input) updateOverlayStyle(false);
                    });

                    function adjustInputWidth() {
                        const textVal = (input.value || '').trim();
                        const len = textVal.length;

                        // Dynamic font size scaling based on text length
                        let currentFs = fs;
                        if (len > 35) {
                            currentFs = Math.max(11, fs * 0.60);
                        } else if (len > 22) {
                            currentFs = Math.max(11, fs * 0.72);
                        } else if (len > 12) {
                            currentFs = Math.max(12, fs * 0.85);
                        }
                        input.style.fontSize = `${currentFs}px`;

                        // Calculate max allowed width (prevent breaking canvas layout)
                        const baseWidthPx = imgW ? (zone.rect.width / 100) * imgW : 60;
                        const maxAllowedWidthPx = imgW ? Math.min(imgW * 0.75, 360) : 320;
                        const charCount = Math.max(len, 2);
                        
                        // Generous width calculation to guarantee text never gets cut off when blurred
                        const minCalculatedWidth = charCount * (currentFs * 0.74) + 26;
                        const finalWidthPx = Math.min(Math.max(minCalculatedWidth, baseWidthPx || 60), maxAllowedWidthPx);

                        input.style.maxWidth = `${maxAllowedWidthPx}px`;
                        input.style.width = `${finalWidthPx}px`;

                        // Browser native hover tooltip for long text
                        if (len > 0) {
                            input.title = textVal;
                            overlay.title = textVal;
                        } else {
                            input.removeAttribute('title');
                            overlay.removeAttribute('title');
                        }
                    }

                    input.value = assignments[zone.id] || '';
                    adjustInputWidth();
                    updateOverlayStyle(false);

                    input.addEventListener('focus', () => {
                        if (isReadOnly) return;
                        input.style.textOverflow = 'clip';
                        updateOverlayStyle(true);
                        if (input.value) {
                            try { input.select(); } catch(e) {}
                        }
                    });

                    input.addEventListener('blur', () => {
                        if (isReadOnly) return;
                        input.style.textOverflow = 'ellipsis';
                        updateOverlayStyle(false);
                    });

                    input.addEventListener('input', (e) => {
                        unfilledWarningShown = false;
                        assignments[zone.id] = e.target.value;
                        adjustInputWidth();
                        updateOverlayStyle(true);
                        updateLvl2Progress();
                    });

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const allInputs = Array.from(canvasContainer.querySelectorAll('.player-zone-input'));
                            const currentIdx = allInputs.indexOf(input);
                            if (currentIdx !== -1 && currentIdx + 1 < allInputs.length) {
                                allInputs[currentIdx + 1].focus();
                            } else if (currentIdx !== -1 && currentIdx === allInputs.length - 1) {
                                input.blur();
                            }
                        } else if (e.key === 'Escape') {
                            input.blur();
                        }
                    });

                    overlay.appendChild(input);
                }

                canvasContainer.appendChild(overlay);
            });

            updateLvl2Progress();

            if (lastCheckResult) {
                applyCheckFeedback(lastCheckResult);
            }
        }

        // Render Labels pool in right sidebar
        function renderLabelsPool() {
            const pool = sidebar.querySelector('#labels-pool');
            if (!pool) return;

            pool.innerHTML = '';
            shuffledLabels.forEach((item, idx) => {
                const card = document.createElement('div');
                card.className = 'p-3 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded-xl cursor-pointer shadow-sm select-none transition-all flex items-center gap-2';
                card.setAttribute('data-label-id', `label-${idx}`);
                card.setAttribute('data-label-val', item.label);
                
                card.innerHTML = `
                    <span class="material-symbols-outlined text-[16px] text-text-disabled drag-handle">drag_indicator</span>
                    <span class="text-sm font-medium text-text-main flex-1 break-words leading-tight">${item.label}</span>
                `;

                // Prevent native HTML5 DnD ghost screenshot
                card.addEventListener('dragstart', (e) => e.preventDefault());

                // Custom 60fps Pointer Drag for Sidebar Card
                setupPointerDrag(card, () => {
                    return {
                        labelText: item.label,
                        originElement: card,
                        onDrop: (targetZoneOverlay, dropRect) => {
                            const targetZoneId = targetZoneOverlay.getAttribute('data-zone-id');
                            if (!targetZoneId) return;

                            const oldAssigned = assignments[targetZoneId];
                            assignments[targetZoneId] = item.label;

                            card.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                            card.style.opacity = '';
                            card.style.transform = '';
                            unselectLabelCard(card);

                            if (typeof targetZoneOverlay.updatePlate === 'function') {
                                targetZoneOverlay.updatePlate();
                            }
                            animateFLIPPlacement(dropRect, targetZoneOverlay);

                            if (oldAssigned) {
                                const sideCard = sidebar.querySelector(`[data-label-val="${oldAssigned.replace(/"/g, '&quot;')}"]`);
                                if (sideCard) {
                                    animateFLIPReturn(targetZoneOverlay, sideCard);
                                } else {
                                    syncSidebarPoolWithAssignments();
                                }
                            } else {
                                syncSidebarPoolWithAssignments();
                            }
                        }
                    };
                });

                // Click to Assign (Bidirectional selection)
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isReadOnly) return;
                    if (selectedLabelId === `label-${idx}`) {
                        // Deselect
                        selectedLabelId = null;
                        unselectLabelCard(card);
                    } else {
                        // Select
                        if (selectedLabelId) {
                            const prev = pool.querySelector(`[data-label-id="${selectedLabelId}"]`);
                            if (prev) unselectLabelCard(prev);
                        }
                        selectedLabelId = `label-${idx}`;
                        selectLabelCard(card);

                        // If zone is already selected, assign instantly
                        if (selectedZoneId) {
                            const oldAssigned = assignments[selectedZoneId];
                            assignments[selectedZoneId] = item.label;
                            
                            // Update zone display
                            const zoneOverlay = canvasContainer.querySelector(`[data-zone-id="${selectedZoneId}"]`);
                            if (zoneOverlay) {
                                const activeZ = zones.find(z => z.id === selectedZoneId);
                                if (typeof zoneOverlay.updatePlate === 'function') {
                                    zoneOverlay.updatePlate();
                                }
                                unselectZoneOverlay(zoneOverlay, activeZ);
                                animateFLIPPlacement(card, zoneOverlay);

                                if (oldAssigned) {
                                    const sideCard = sidebar.querySelector(`[data-label-val="${oldAssigned.replace(/"/g, '&quot;')}"]`);
                                    if (sideCard) {
                                        animateFLIPReturn(zoneOverlay, sideCard);
                                    }
                                }
                            }
                            
                            card.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                            unselectLabelCard(card);
                            syncSidebarPoolWithAssignments();
                            
                            selectedZoneId = null;
                            selectedLabelId = null;
                        }
                    }
                });

                // If currently assigned in some zone, show as disabled
                const alreadyAssigned = Object.values(assignments).includes(item.label);
                if (alreadyAssigned) {
                    card.classList.add('opacity-30', 'pointer-events-none', 'hidden');
                }

                pool.appendChild(card);
            });
        }

        // Return current session answer payload
        function getUserAnswerPayload() {
            const payload = {
                answers: { ...assignments }
            };
            if (lastCheckResult && (lastCheckResult.user_override_typo || lastCheckResult.override_typo)) {
                payload.override_typo = true;
            }
            if (lastCheckResult && lastCheckResult.single_retry_copy) {
                payload.single_retry_copy = true;
            }
            return payload;
        }

        // Render visual dual-image review comparison (Студент vs Эталон)
        function renderReviewComparison(result, hostContainer) {
            const host = hostContainer || container;
            if (!host) return;

            let reviewSection = host.querySelector('[data-image-labeling="review-comparison"]');
            if (reviewSection) {
                reviewSection.remove();
            }

            const details = (result && result.details) || {};
            const zoneResults = details.zone_results || details || {};
            const isSuccess = result && result.success === true;

            reviewSection = document.createElement('section');
            reviewSection.className = 'w-full mt-6 rounded-3xl border border-border-subtle bg-surface-1/90 p-5 shadow-md z-10 box-border';
            reviewSection.setAttribute('data-image-labeling', 'review-comparison');

            const titleText = isSuccess ? 'Разбор ответа' : 'Разбор ошибок';
            const descText = isSuccess
                ? 'Ваше решение совпало с эталоном. Наведите на область на любом рисунке — она подсветится на обоих изображениях одновременно.'
                : 'Слева сохранён ваш ответ, справа показан эталон на том же изображении. Наведите на область — она подсветится на обоих рисунках одновременно для быстрой сверки.';

            reviewSection.innerHTML = `
                <div class="flex items-center justify-between gap-3 border-b border-border-subtle pb-3 mb-4">
                    <div>
                        <h3 class="text-base font-bold text-text-main flex items-center gap-2">
                            <span class="material-symbols-outlined ${isSuccess ? 'text-emerald-500' : 'text-rose-500'}">
                                ${isSuccess ? 'check_circle' : 'cancel'}
                            </span>
                            <span>${titleText}</span>
                        </h3>
                        <p class="text-xs text-text-secondary mt-0.5 leading-relaxed">${descText}</p>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5" id="review-cards-grid">
                </div>
            `;

            const cardsGrid = reviewSection.querySelector('#review-cards-grid');

            // Card 1: Student
            const userCard = createReviewPreviewCard({
                title: 'Ваш ответ',
                isUser: true,
                zoneResults,
                zones,
                imageSrc
            });

            // Card 2: Reference
            const refCard = createReviewPreviewCard({
                title: 'Правильный ответ (Эталон)',
                isUser: false,
                zoneResults,
                zones,
                imageSrc
            });

            cardsGrid.appendChild(userCard);
            cardsGrid.appendChild(refCard);

            setupReviewHoverSync(reviewSection);

            host.appendChild(reviewSection);
        }

        function createReviewPreviewCard({ title, isUser, zoneResults, zones, imageSrc }) {
            const card = document.createElement('div');
            card.className = 'flex flex-col bg-surface-2 border border-border-subtle rounded-2xl overflow-hidden shadow-sm';

            const head = document.createElement('div');
            head.className = 'px-4 py-2.5 bg-surface-3/60 border-b border-border-subtle flex items-center justify-between';
            head.innerHTML = `
                <span class="text-xs font-bold text-text-main uppercase tracking-wider">${title}</span>
                <span class="text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${isUser ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600'}">
                    ${isUser ? 'Студент' : 'Эталон'}
                </span>
            `;
            card.appendChild(head);

            const imgWrap = document.createElement('div');
            imgWrap.className = 'relative w-full overflow-hidden flex items-center justify-center bg-bg-main p-2';
            imgWrap.style.minHeight = '280px';

            const cardImg = document.createElement('img');
            cardImg.src = imageSrc;
            cardImg.className = 'max-w-full h-auto block rounded-lg pointer-events-none select-none';
            imgWrap.appendChild(cardImg);

            const overlayLayer = document.createElement('div');
            overlayLayer.className = 'absolute inset-0 pointer-events-none';

            zones.forEach(zone => {
                const zEntry = zoneResults[zone.id];
                const isCorrect = isUser ? (zEntry && (typeof zEntry === 'object' ? zEntry.is_correct === true : zEntry === true)) : true;
                const assignedText = isUser ? (assignments[zone.id] || (zEntry && typeof zEntry === 'object' && zEntry.actual) || '') : zone.label;

                const zoneEl = document.createElement('div');
                zoneEl.className = 'absolute border rounded flex items-center justify-center p-1 box-border transition-all pointer-events-auto cursor-pointer';
                zoneEl.style.left = `${zone.rect.x}%`;
                zoneEl.style.top = `${zone.rect.y}%`;
                zoneEl.style.minWidth = `${zone.rect.width}%`;
                zoneEl.style.minHeight = `${zone.rect.height}%`;
                zoneEl.setAttribute('data-review-zone-id', zone.id);

                if (isUser) {
                    if (isCorrect) {
                        zoneEl.style.borderColor = 'var(--color-success, #10b981)';
                        zoneEl.style.backgroundColor = 'rgba(16, 185, 129, 0.18)';
                    } else {
                        zoneEl.style.borderColor = 'var(--color-error, #ef4444)';
                        zoneEl.style.backgroundColor = 'rgba(239, 68, 68, 0.18)';
                    }
                } else {
                    zoneEl.style.borderColor = 'var(--color-primary, #6366f1)';
                    zoneEl.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
                }

                const labelSpan = document.createElement('span');
                labelSpan.className = 'text-center font-bold px-2 py-0.5 rounded text-[11px] leading-tight max-w-full break-words shadow-sm';
                labelSpan.textContent = assignedText || (isUser ? '?' : zone.label);

                if (isUser) {
                    if (isCorrect) {
                        labelSpan.style.backgroundColor = 'var(--color-success, #10b981)';
                        labelSpan.style.color = '#ffffff';
                    } else {
                        labelSpan.style.backgroundColor = 'var(--color-error, #ef4444)';
                        labelSpan.style.color = '#ffffff';
                    }
                } else {
                    labelSpan.style.backgroundColor = 'var(--color-primary, #6366f1)';
                    labelSpan.style.color = '#ffffff';
                }

                zoneEl.appendChild(labelSpan);
                overlayLayer.appendChild(zoneEl);
            });

            imgWrap.appendChild(overlayLayer);
            card.appendChild(imgWrap);
            return card;
        }

        function setupReviewHoverSync(rootEl) {
            const allReviewZones = rootEl.querySelectorAll('[data-review-zone-id]');
            allReviewZones.forEach(el => {
                const zid = el.getAttribute('data-review-zone-id');
                el.addEventListener('mouseenter', () => {
                    rootEl.querySelectorAll(`[data-review-zone-id="${zid}"]`).forEach(matched => {
                        matched.style.outline = '3px solid #f59e0b';
                        matched.style.outlineOffset = '2px';
                        matched.style.transform = 'scale(1.05)';
                        matched.style.zIndex = '30';
                        matched.style.boxShadow = '0 0 16px rgba(245, 158, 11, 0.6)';
                    });
                });
                el.addEventListener('mouseleave', () => {
                    rootEl.querySelectorAll(`[data-review-zone-id="${zid}"]`).forEach(matched => {
                        matched.style.outline = '';
                        matched.style.outlineOffset = '';
                        matched.style.transform = '';
                        matched.style.zIndex = '';
                        matched.style.boxShadow = '';
                    });
                });
            });
        }

        // Apply evaluator check feedback
        function applyCheckFeedback(result) {
            isReadOnly = true;
            lastCheckResult = result;
            const details = result.details || {};
            const zoneResults = details.zone_results || details || {};
            
            if (sidebar) {
                sidebar.classList.add('pointer-events-none', 'opacity-90');
            }

            // Loop through all overlays
            canvasContainer.querySelectorAll('.player-zone-overlay').forEach(overlay => {
                overlay.style.pointerEvents = 'none';
                const zoneId = overlay.getAttribute('data-zone-id');
                const zoneEntry = zoneResults[zoneId];
                
                if (zoneEntry === undefined || zoneEntry === null) return;
                
                const status = (typeof zoneEntry === 'object' && zoneEntry.status)
                    ? zoneEntry.status
                    : (typeof zoneEntry === 'object'
                        ? (zoneEntry.is_correct ? 'correct' : (zoneEntry.is_typo ? 'typo' : 'incorrect'))
                        : (zoneEntry === true ? 'correct' : 'incorrect'));

                overlay.style.boxShadow = 'none';
                const labelSpan = overlay.querySelector('span');
                const input = overlay.querySelector('input');
                const emptyIcon = overlay.querySelector('.lvl2-empty-icon');
                if (emptyIcon) emptyIcon.style.display = 'none';

                const expectedLabel = (typeof zoneEntry === 'object' && zoneEntry.expected)
                    ? zoneEntry.expected
                    : (zones.find(z => z.id === zoneId) || {}).label;

                if (status === 'correct') {
                    // Success styling — Green
                    overlay.style.borderColor = 'var(--color-success, #10b981)';
                    overlay.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.35)';
                    overlay.style.backgroundColor = '#ecfdf5';
                    overlay.title = 'Правильно!';
                    
                    if (labelSpan) {
                        labelSpan.style.backgroundColor = 'var(--color-success, #10b981)';
                        labelSpan.style.borderColor = 'var(--color-success-dark, #059669)';
                        labelSpan.style.color = '#ffffff';
                    }
                    if (input) {
                        input.style.color = '#047857';
                        input.disabled = true;
                        input.readOnly = true;
                    }

                    // Green check badge
                    if (!overlay.querySelector('.status-check-badge')) {
                        const checkBadge = document.createElement('div');
                        checkBadge.className = 'status-check-badge absolute -top-2.5 -right-2.5 z-40 bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md border border-white';
                        checkBadge.innerHTML = '<span class="material-symbols-outlined text-[13px] font-bold">check</span>';
                        overlay.appendChild(checkBadge);
                    }

                } else if (status === 'typo') {
                    // Typo / Warning styling — Amber / Yellow
                    overlay.style.borderColor = '#f59e0b';
                    overlay.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.35)';
                    overlay.style.backgroundColor = '#fffbeb';
                    overlay.style.pointerEvents = 'auto';
                    
                    if (labelSpan) {
                        labelSpan.style.backgroundColor = '#f59e0b';
                        labelSpan.style.color = '#ffffff';
                    }
                    if (input) {
                        input.style.color = '#b45309';
                        input.disabled = true;
                        input.readOnly = true;
                    }

                    // Floating animated typo badge
                    if (!overlay.querySelector('.hint-q-badge')) {
                        const qMark = document.createElement('div');
                        qMark.className = 'hint-q-badge absolute z-40 flex items-center justify-center font-black text-white text-xs select-none shadow-md cursor-pointer rounded-full overflow-hidden';
                        qMark.style.width = '22px';
                        qMark.style.height = '22px';
                        qMark.style.boxSizing = 'border-box';
                        qMark.style.left = 'calc(100% + 6px)';
                        qMark.style.top = '50%';
                        qMark.style.transform = 'translateY(-50%)';
                        qMark.style.backgroundColor = '#f59e0b';
                        qMark.style.border = '2px solid #ffffff';
                        qMark.innerHTML = '<span class="material-symbols-outlined text-[11px] leading-none flex items-center justify-center text-white shrink-0">warning</span>';
                        qMark.title = 'Опечатка. Наведите для просмотра ответа';
                        overlay.appendChild(qMark);
                    }

                    // Hover tooltip popover: "Опечатка. Должно быть: {expected}"
                    if (expectedLabel) {
                        let activeTooltip = null;
                        overlay.addEventListener('mouseenter', () => {
                            if (activeTooltip) activeTooltip.remove();
                            const rect = overlay.getBoundingClientRect();
                            activeTooltip = document.createElement('div');
                            activeTooltip.className = 'fixed z-[999999] pointer-events-none flex items-center gap-1.5 font-bold text-xs px-3.5 py-2 select-none shadow-xl';
                            activeTooltip.style.backgroundColor = '#d97706';
                            activeTooltip.style.color = '#ffffff';
                            activeTooltip.style.borderRadius = '10px';
                            activeTooltip.style.border = '1px solid rgba(255, 255, 255, 0.4)';
                            activeTooltip.style.left = `${rect.left + rect.width / 2}px`;
                            activeTooltip.style.top = `${rect.top - 42}px`;
                            activeTooltip.style.transform = 'translateX(-50%)';
                            activeTooltip.innerHTML = `<span class="material-symbols-outlined text-[16px]">edit_note</span><span>Опечатка! Правильно: <strong>${expectedLabel}</strong></span>`;
                            document.body.appendChild(activeTooltip);
                        });

                        overlay.addEventListener('mouseleave', () => {
                            if (activeTooltip) {
                                activeTooltip.remove();
                                activeTooltip = null;
                            }
                        });
                    }

                } else {
                    // Incorrect styling — Red
                    overlay.style.borderColor = '#ef4444';
                    overlay.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.35)';
                    overlay.style.backgroundColor = '#fef2f2';
                    overlay.style.pointerEvents = 'auto';
                    
                    if (labelSpan) {
                        labelSpan.style.backgroundColor = '#ef4444';
                        labelSpan.style.color = '#ffffff';
                    }
                    if (input) {
                        input.style.color = '#b91c1c';
                        input.disabled = true;
                        input.readOnly = true;
                    }

                    if (!document.getElementById('pulse-qmark-style')) {
                        const styleEl = document.createElement('style');
                        styleEl.id = 'pulse-qmark-style';
                        styleEl.textContent = `
                            @keyframes pulseQMarkRight {
                                0%, 100% { transform: translateY(-50%) scale(1); box-shadow: 0 4px 10px rgba(220, 38, 38, 0.4); }
                                50% { transform: translateY(-50%) scale(1.18); box-shadow: 0 6px 16px rgba(220, 38, 38, 0.7); }
                            }
                        `;
                        document.head.appendChild(styleEl);
                    }

                    // Floating animated error badge
                    if (!overlay.querySelector('.hint-q-badge')) {
                        const qMark = document.createElement('div');
                        qMark.className = 'hint-q-badge absolute z-40 flex items-center justify-center font-black text-white text-xs select-none shadow-lg cursor-pointer rounded-full';
                        qMark.style.width = '24px';
                        qMark.style.height = '24px';
                        qMark.style.left = 'calc(100% + 6px)';
                        qMark.style.top = '50%';
                        qMark.style.backgroundColor = '#dc2626';
                        qMark.style.border = '2px solid #ffffff';
                        qMark.style.animation = 'pulseQMarkRight 1.8s infinite ease-in-out';
                        qMark.textContent = '?';
                        qMark.title = 'Неверно. Наведите для просмотра ответа';
                        overlay.appendChild(qMark);
                    }

                    if (expectedLabel) {
                        let activeTooltip = null;
                        overlay.addEventListener('mouseenter', () => {
                            if (activeTooltip) activeTooltip.remove();
                            const rect = overlay.getBoundingClientRect();
                            activeTooltip = document.createElement('div');
                            activeTooltip.className = 'fixed z-[999999] pointer-events-none flex items-center gap-1.5 font-bold text-xs px-3.5 py-2 select-none shadow-xl';
                            activeTooltip.style.backgroundColor = '#dc2626';
                            activeTooltip.style.color = '#ffffff';
                            activeTooltip.style.borderRadius = '10px';
                            activeTooltip.style.border = '1px solid rgba(255, 255, 255, 0.4)';
                            activeTooltip.style.left = `${rect.left + rect.width / 2}px`;
                            activeTooltip.style.top = `${rect.top - 42}px`;
                            activeTooltip.style.transform = 'translateX(-50%)';
                            activeTooltip.innerHTML = `<span class="material-symbols-outlined text-[16px]">cancel</span><span>Правильный ответ: <strong>${expectedLabel}</strong></span>`;
                            document.body.appendChild(activeTooltip);
                        });

                        overlay.addEventListener('mouseleave', () => {
                            if (activeTooltip) {
                                activeTooltip.remove();
                                activeTooltip = null;
                            }
                        });
                    }
                }
            });

            // Update Level 2 Sidebar with status cards
            if (difficulty === 2 && sidebar) {
                const zonesListEl = sidebar.querySelector('#lvl2-zones-list');
                if (zonesListEl) {
                    zonesListEl.innerHTML = '';
                    zones.forEach((z, i) => {
                        const zoneEntry = zoneResults[z.id] || {};
                        const val = (assignments[z.id] || '').trim();
                        const status = (typeof zoneEntry === 'object' && zoneEntry.status)
                            ? zoneEntry.status
                            : (typeof zoneEntry === 'object'
                                ? (zoneEntry.is_correct ? 'correct' : (zoneEntry.is_typo ? 'typo' : 'incorrect'))
                                : (zoneEntry === true ? 'correct' : 'incorrect'));
                        
                        const expected = zoneEntry.expected || z.label;
                        
                        let cardClass = '';
                        let statusIcon = '';
                        let statusLabel = '';
                        
                        if (status === 'correct') {
                            cardClass = 'bg-emerald-50 border-emerald-300 text-emerald-900';
                            statusIcon = '<span class="material-symbols-outlined text-[16px] text-emerald-600">check_circle</span>';
                            statusLabel = 'Верно';
                        } else if (status === 'typo') {
                            cardClass = 'bg-amber-50 border-amber-300 text-amber-900';
                            statusIcon = '<span class="material-symbols-outlined text-[16px] text-amber-600">warning</span>';
                            statusLabel = `Опечатка (Правильно: ${expected})`;
                        } else {
                            cardClass = 'bg-red-50 border-red-300 text-red-900';
                            statusIcon = '<span class="material-symbols-outlined text-[16px] text-red-600">cancel</span>';
                            statusLabel = `Неверно (Правильно: ${expected})`;
                        }
                        
                        const card = document.createElement('div');
                        card.className = `p-2.5 rounded-xl border text-xs transition-all flex flex-col gap-1 ${cardClass}`;
                        card.innerHTML = `
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    <span class="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 bg-white shadow-2xs">${i + 1}</span>
                                    <span class="truncate font-semibold">${val || '(пусто)'}</span>
                                </div>
                                ${statusIcon}
                            </div>
                            <div class="text-[11px] opacity-80 pl-7 font-medium">${statusLabel}</div>
                        `;
                        zonesListEl.appendChild(card);
                    });
                }

                // Typo Self-Assessment Choice Banner
                const hasTypo = Object.values(zoneResults).some(z => (typeof z === 'object' && (z.status === 'typo' || z.is_typo)));
                if (hasTypo) {
                    const existingBanner = sidebar.querySelector('#typo-decision-banner');
                    if (existingBanner) existingBanner.remove();

                    const banner = document.createElement('div');
                    banner.id = 'typo-decision-banner';
                    banner.className = 'm-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-3 shrink-0 animate-fade-in shadow-lg';
                    banner.innerHTML = `
                        <div class="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                            <span class="material-symbols-outlined text-[20px] text-amber-500 shrink-0 mt-0.5">warning</span>
                            <div class="space-y-0.5">
                                <div class="font-bold text-sm">Обнаружена опечатка!</div>
                                <div class="opacity-90 leading-tight">Система распознала неточности в буквах. Выберите решение:</div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-2 pt-1">
                            <button id="btn-accept-typo" class="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer">
                                <span class="material-symbols-outlined text-[16px]">check_circle</span>
                                <span>Зачесть как верный ответ</span>
                            </button>
                            <button id="btn-retry-typo" class="w-full py-2 px-3 rounded-xl bg-surface-1 border border-amber-500/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/10 font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
                                <span class="material-symbols-outlined text-[16px]">replay</span>
                                <span>Повторить в колоде (1 копия)</span>
                            </button>
                        </div>
                    `;
                    sidebar.appendChild(banner);

                    banner.querySelector('#btn-accept-typo').addEventListener('click', () => {
                        banner.innerHTML = `
                            <div class="flex items-center gap-2 text-emerald-600 font-bold py-1">
                                <span class="material-symbols-outlined text-[20px]">task_alt</span>
                                <span>Ответ зачтён как верный!</span>
                            </div>
                        `;
                        canvasContainer.querySelectorAll('.player-zone-overlay').forEach(overlay => {
                            const zoneId = overlay.getAttribute('data-zone-id');
                            const zRes = zoneResults[zoneId];
                            if (zRes && (zRes.status === 'typo' || zRes.is_typo)) {
                                overlay.style.borderColor = 'var(--color-success, #10b981)';
                                overlay.style.backgroundColor = '#ecfdf5';
                                overlay.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.35)';
                                const input = overlay.querySelector('input');
                                if (input) input.style.color = '#047857';
                            }
                        });
                        if (!lastCheckResult) lastCheckResult = {};
                        lastCheckResult.success = true;
                        lastCheckResult.score = 100;
                        lastCheckResult.user_override_typo = true;
                        lastCheckResult.override_typo = true;

                        if (typeof window.handleSubmitAnswer === 'function') {
                            window.handleSubmitAnswer();
                        }
                    });

                    banner.querySelector('#btn-retry-typo').addEventListener('click', () => {
                        banner.innerHTML = `
                            <div class="flex items-center gap-2 text-amber-600 font-bold py-1">
                                <span class="material-symbols-outlined text-[20px]">published_with_changes</span>
                                <span>Добавлена 1 копия в колоду</span>
                            </div>
                        `;
                        if (!lastCheckResult) lastCheckResult = {};
                        lastCheckResult.success = false;
                        lastCheckResult.single_retry_copy = true;

                        if (typeof window.handleSubmitAnswer === 'function') {
                            window.handleSubmitAnswer();
                        }
                    });
                }
            }

            // Remove review comparison if present on S1
            const existingReview = container.querySelector('[data-image-labeling="review-comparison"]');
            if (existingReview) existingReview.remove();
        }

        function restoreInput(draft) {
            isReadOnly = false;
            if (sidebar) sidebar.classList.remove('pointer-events-none', 'opacity-50');
            if (draft && draft.answers) {
                assignments = { ...draft.answers };
            } else {
                assignments = {};
                lastCheckResult = null;
            }
            renderInteractiveZones();
            if (difficulty === 1) {
                renderLabelsPool();
            }
            syncSidebarPoolWithAssignments();
        }

        function getViewState() {
            return {
                zoomLevel,
                panX,
                panY
            };
        }

        let unfilledWarningShown = false;

        function validateBeforeSubmit() {
            const totalZones = zones.length;
            const filledCount = Object.keys(assignments).filter(k => assignments[k] && String(assignments[k]).trim() !== '').length;
            if (filledCount < totalZones) {
                const missingCount = totalZones - filledCount;
                if (!unfilledWarningShown) {
                    unfilledWarningShown = true;
                    return {
                        valid: false,
                        message: `Заполнены не все области (осталось: ${missingCount}). Нажмите «Проверить» ещё раз, чтобы отправить как есть.`
                    };
                }
            }
            unfilledWarningShown = false;
            return { valid: true };
        }

        function restoreViewState(viewState) {
            if (viewState) {
                zoomLevel = viewState.zoomLevel || 1.0;
                panX = viewState.panX || 0;
                panY = viewState.panY || 0;
                updateTransform();
            }
        }

        function cleanup() {
            window.removeEventListener('resize', onResize);
        }

        return {
            getUserAnswerPayload,
            applyCheckFeedback,
            renderReviewComparison,
            restoreInput,
            getViewState,
            restoreViewState,
            validateBeforeSubmit,
            cleanup
        };
    }

    return {
        render(containerElement, task) {
            if (currentInstance && typeof currentInstance.cleanup === 'function') {
                currentInstance.cleanup();
            }
            currentInstance = createRoot(containerElement, task);
        },
        getUserAnswerPayload() {
            if (currentInstance && typeof currentInstance.getUserAnswerPayload === 'function') {
                return currentInstance.getUserAnswerPayload();
            }
            return { answers: {} };
        },
        validateBeforeSubmit() {
            if (currentInstance && typeof currentInstance.validateBeforeSubmit === 'function') {
                return currentInstance.validateBeforeSubmit();
            }
            return { valid: true };
        },
        applyCheckFeedback(result) {
            if (currentInstance && typeof currentInstance.applyCheckFeedback === 'function') {
                currentInstance.applyCheckFeedback(result);
            }
        },
        renderReviewComparison(result, hostContainer) {
            if (currentInstance && typeof currentInstance.renderReviewComparison === 'function') {
                currentInstance.renderReviewComparison(result, hostContainer);
            }
        },
        restoreInput(draft) {
            if (currentInstance && typeof currentInstance.restoreInput === 'function') {
                currentInstance.restoreInput(draft);
            }
        },
        getViewState() {
            if (currentInstance && typeof currentInstance.getViewState === 'function') {
                return currentInstance.getViewState();
            }
            return null;
        },
        restoreViewState(viewState) {
            if (currentInstance && typeof currentInstance.restoreViewState === 'function') {
                currentInstance.restoreViewState(viewState);
            }
        },
        cleanup() {
            if (currentInstance && typeof currentInstance.cleanup === 'function') {
                currentInstance.cleanup();
            }
            currentInstance = null;
        }
    };
})();

// Attach to window for global access
window.ImageLabelUI = ImageLabelUI;

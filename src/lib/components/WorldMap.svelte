<script lang="ts">
  import type { Geometry, LandsInfo } from '$lib/types.js';
  import { formatName } from '$lib/quiz.js';

  interface Props {
    geometry: Geometry;
    landsInfo: LandsInfo;
    viewBox: string;
    regionIds: string[];
    foundIds?: string[];
    wrongFlashId?: string;
    correctFlashId?: string;
    /** Pulsing hint ring shown at this country's centroid */
    hintPulseId?: string;
    quizActive?: boolean;
    onLandClick?: (id: string) => void;
  }

  let {
    geometry,
    landsInfo,
    viewBox,
    regionIds,
    foundIds = [],
    wrongFlashId = '',
    correctFlashId = '',
    hintPulseId = '',
    quizActive = false,
    onLandClick = () => {}
  }: Props = $props();

  const FILL_COLORS = [
    '#6fa8c0', '#6aacdc', '#79bb8d', '#c4a84f', '#a87abf',
    '#c8784c', '#52b3a0', '#c4b94a', '#c07070', '#5890c0',
    '#87be70', '#c8a070', '#9880c0', '#70be88'
  ];

  // Parse viewBox to get width for scaling circles
  let vbWidth = $derived(
    (() => { const p = viewBox.split(' ').map(Number); return p[2] ?? 10968; })()
  );
  // Circle radius ≈ 8–10px on screen at any zoom level
  let circleR = $derived(Math.max(12, vbWidth / 115));
  // Label font size ≈ 18–20px on screen at any zoom level
  let labelSize = $derived(Math.round(vbWidth / 68));

  function getFill(id: string): string {
    if (id === correctFlashId) return '#51cf66';
    if (id === wrongFlashId)   return '#ff6b6b';
    if (foundIds.includes(id)) return '#3d8a50';
    const n = landsInfo[id]?.fillColorNumber ?? 0;
    return FILL_COLORS[n % FILL_COLORS.length];
  }

  function getStroke(id: string): string {
    if (id === correctFlashId || id === wrongFlashId) return '#fff';
    if (foundIds.includes(id)) return 'rgba(255,255,255,0.5)';
    return 'rgba(255,255,255,0.25)';
  }

  type LabelEntry = { id: string; color: string };
  let labels = $derived<LabelEntry[]>([
    ...foundIds.map(id => ({ id, color: '#ffffff' })),
    ...(wrongFlashId  ? [{ id: wrongFlashId,   color: '#ffcc66' }] : []),
    ...(correctFlashId ? [{ id: correctFlashId, color: '#ffffff' }] : [])
  ]);

  // Countries that need a dot because they're too small to click reliably
  let circleIds = $derived(
    regionIds.filter(id => landsInfo[id]?.showCircle && landsInfo[id]?.cx !== undefined)
  );
</script>

<svg
  {viewBox}
  xmlns="http://www.w3.org/2000/svg"
  class="world-map"
  preserveAspectRatio="xMidYMid meet"
>
  <!-- Land shapes -->
  {#each regionIds as id (id)}
    {#if geometry[id]}
      {@const fill = getFill(id)}
      {@const stroke = getStroke(id)}
      {#each [...(geometry[id].land ?? []), ...(geometry[id].island ?? [])] as d, i (i)}
        <path
          {d} {fill} {stroke}
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          class:clickable={quizActive}
          onclick={() => quizActive && onLandClick(id)}
          role={quizActive ? 'button' : undefined}
        />
      {/each}
    {/if}
  {/each}

  <!-- Small-country click circles -->
  {#each circleIds as id (id + '-circle')}
    {@const info = landsInfo[id]}
    {@const fill = getFill(id)}
    <circle
      cx={info.cx}
      cy={info.cy}
      r={circleR}
      {fill}
      stroke="rgba(255,255,255,0.6)"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      class:clickable={quizActive}
      onclick={() => quizActive && onLandClick(id)}
      role={quizActive ? 'button' : undefined}
    />
  {/each}

  <!-- Hint pulse ring -->
  {#if hintPulseId}
    {@const info = landsInfo[hintPulseId]}
    {#if info?.cx !== undefined}
      <circle
        cx={info.cx}
        cy={info.cy}
        r={circleR * 5}
        fill="none"
        stroke="#ffd43b"
        stroke-width="3"
        vector-effect="non-scaling-stroke"
        class="pulse-ring"
        pointer-events="none"
      />
    {/if}
  {/if}

  <!-- Country name labels (found + flash) -->
  {#each labels as { id, color } (id + color)}
    {@const info = landsInfo[id]}
    {#if info?.cx !== undefined && info.cy !== undefined}
      <text
        x={info.cx}
        y={info.cy}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={labelSize}
        font-weight="700"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fill={color}
        stroke="#0d1b2e"
        stroke-width={labelSize * 0.25}
        paint-order="stroke"
        pointer-events="none"
      >
        {formatName(id)}
      </text>
    {/if}
  {/each}
</svg>

<style>
  .world-map {
    width: 100%;
    height: 100%;
    display: block;
    background: #0d1b2e;
  }

  path, circle {
    transition: fill 0.12s ease;
  }

  .clickable {
    cursor: pointer;
  }

  .clickable:hover {
    opacity: 0.75;
  }

  .pulse-ring {
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.15; }
  }
</style>

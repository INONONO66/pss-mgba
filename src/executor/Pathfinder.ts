export interface Position {
  y: number;
  x: number;
}

export interface PathResult {
  status: "found" | "partial" | "no_path";
  path: Position[]; // Sequence of positions to walk (excludes start, includes end)
  reachedPosition: Position; // Where the path actually ends
}

// Node in the A* open/closed set
interface AStarNode {
  pos: Position;
  g: number; // cost from start
  f: number; // g + h
  parent: AStarNode | null;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.y - b.y) + Math.abs(a.x - b.x);
}

function posKey(pos: Position): number {
  // Encode position as a single integer for fast lookup (max 20×18 = 360 tiles)
  return pos.y * 256 + pos.x;
}

function reconstructPath(node: AStarNode): Position[] {
  const path: Position[] = [];
  let current: AStarNode | null = node;
  while (current !== null && current.parent !== null) {
    path.push(current.pos);
    current = current.parent;
  }
  path.reverse();
  return path;
}

const DIRECTIONS: Position[] = [
  { y: -1, x: 0 }, // up
  { y: 1, x: 0 }, // down
  { y: 0, x: -1 }, // left
  { y: 0, x: 1 }, // right
];

/**
 * A* pathfinding on a 2D boolean grid.
 * true = walkable, false = impassable (wall or unexplored).
 * 4-directional movement only (up/down/left/right).
 */
export function findPath(
  grid: boolean[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
): PathResult {
  // Edge case: start === goal
  if (start.y === goal.y && start.x === goal.x) {
    return { status: "found", path: [], reachedPosition: goal };
  }

  // Edge case: goal out of bounds
  if (goal.y < 0 || goal.y >= height || goal.x < 0 || goal.x >= width) {
    return { status: "no_path", path: [], reachedPosition: start };
  }

  // Edge case: start not walkable
  if (!grid[start.y]?.[start.x]) {
    return { status: "no_path", path: [], reachedPosition: start };
  }

  // Open set as a sorted array (tiny grids, max 360 nodes — simple sort is fine)
  const openSet: AStarNode[] = [];
  const closedSet = new Set<number>();

  // Track best g-cost per position to avoid duplicates
  const gCosts = new Map<number, number>();

  const startNode: AStarNode = {
    pos: start,
    g: 0,
    f: manhattan(start, goal),
    parent: null,
  };

  openSet.push(startNode);
  gCosts.set(posKey(start), 0);

  // Track the closed-set node closest to goal (for partial path)
  let closestNode: AStarNode = startNode;
  let closestDist = manhattan(start, goal);

  while (openSet.length > 0) {
    // Pop node with lowest f (sort ascending, pop from end for efficiency)
    openSet.sort((a, b) => b.f - a.f);
    const current = openSet.pop()!;
    const currentKey = posKey(current.pos);

    if (closedSet.has(currentKey)) continue;
    closedSet.add(currentKey);

    // Update closest node tracking
    const distToGoal = manhattan(current.pos, goal);
    if (distToGoal < closestDist) {
      closestDist = distToGoal;
      closestNode = current;
    }

    // Goal reached
    if (current.pos.y === goal.y && current.pos.x === goal.x) {
      return {
        status: "found",
        path: reconstructPath(current),
        reachedPosition: current.pos,
      };
    }

    // Expand neighbors
    for (const dir of DIRECTIONS) {
      const ny = current.pos.y + dir.y;
      const nx = current.pos.x + dir.x;

      // Bounds check
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;

      // Walkability check
      if (!grid[ny]?.[nx]) continue;

      const neighborPos: Position = { y: ny, x: nx };
      const neighborKey = posKey(neighborPos);

      if (closedSet.has(neighborKey)) continue;

      const tentativeG = current.g + 1;
      const existingG = gCosts.get(neighborKey);

      if (existingG !== undefined && tentativeG >= existingG) continue;

      gCosts.set(neighborKey, tentativeG);
      const h = manhattan(neighborPos, goal);
      openSet.push({
        pos: neighborPos,
        g: tentativeG,
        f: tentativeG + h,
        parent: current,
      });
    }
  }

  // Open set exhausted — goal not reached
  // Check if we made any progress toward goal
  const startKey = posKey(start);
  const closestKey = posKey(closestNode.pos);

  if (closestKey === startKey) {
    // Never moved closer — no path at all
    return { status: "no_path", path: [], reachedPosition: start };
  }

  // Partial path to closest reachable position
  return {
    status: "partial",
    path: reconstructPath(closestNode),
    reachedPosition: closestNode.pos,
  };
}

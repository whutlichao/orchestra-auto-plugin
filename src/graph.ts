// Render plans for the recorded topology graph.
//
// `planGraph` decides which recorded rows fit the render budget and which rail
// cells a child needs: a rail is drawn only while its recorded ancestor still
// has a later sibling, so a trunk ends where its branch ends.
//
// `planRunGraph` groups those rows into one block per top-level worker and pairs
// the blocks into two lanes around the coordinator spine. Membership (the
// coordinator-to-member tick) is a run fact drawn by the panel, not a parent
// edge; a recorded parent edge never crosses a lane. Neither planner adds a
// node, a parent or a child: every row comes from `buildTopology`.
import type { TopologyWorker } from './topology'

export type GraphRow = {
  node: TopologyWorker
  /** 0 for a worker whose recorded parent is absent: top-level row. */
  depth: number
  /**
   * One flag per drawn ancestor rail, starting with the sibling group of the
   * ancestor at depth 1. `true` means that ancestor has a later sibling, so its
   * trunk continues past this row. A depth-0 or depth-1 row has no rails: the
   * only trunk it needs is its own incoming edge.
   */
  rails: boolean[]
  /** This row's own trunk continues below it, toward a later sibling. */
  hasFollowingSibling: boolean
  /** Nodes omitted below this row because the render budget ran out. */
  cutChildren: number
}

export type GraphPlan = {
  rows: GraphRow[]
  /** Nodes in this graph, including the ones the budget left out. */
  total: number
  shown: number
  truncated: boolean
}

/**
 * One top-level worker and the rows of its recorded subtree, in draw order.
 * `children` keeps the rails the planner already computed for the lane.
 */
export type MemberBlock = {
  node: TopologyWorker
  children: GraphRow[]
  /** Nodes hidden below this member because the render budget ran out. */
  cutChildren: number
}

/**
 * Two top-level workers around the coordinator's spine. A projection with an
 * odd number of members leaves the right lane of the last row empty.
 */
export type RunGraphRow = {
  left: MemberBlock | null
  right: MemberBlock | null
}

export type RunGraphPlan = {
  rows: RunGraphRow[]
  /** Top-level workers placed in the graph. */
  members: number
  /** Top-level workers in the projection, including the ones the budget cut. */
  memberTotal: number
  /** Nodes in the graph, including the ones the budget left out. */
  total: number
  shown: number
  truncated: boolean
}

/** A node plus every recorded descendant below it. */
function subtreeSize(node: TopologyWorker): number {
  return 1 + node.descendantCount
}

/**
 * Walk the recorded tree in pre-order and keep at most `limit` rows.
 *
 * A cut is reported on the nearest rendered ancestor, with the full number of
 * nodes it hides, so a truncation marker never understates what is missing.
 */
export function planGraph(roots: TopologyWorker[], limit: number): GraphPlan {
  const total = roots.reduce((sum, root) => sum + subtreeSize(root), 0)
  const rows: GraphRow[] = []
  const budget = Math.max(0, limit)

  const visit = (
    node: TopologyWorker,
    depth: number,
    rails: boolean[],
    hasFollowingSibling: boolean
  ): boolean => {
    if (rows.length >= budget) return false
    const row: GraphRow = {
      node,
      depth,
      rails,
      hasFollowingSibling,
      cutChildren: 0
    }
    rows.push(row)
    node.children.forEach((child, index) => {
      // A depth-0 row's own trunk is not drawn, so its sibling flag never
      // becomes a rail below it: only recorded parent edges do.
      // Rails are built by spreading, so the shared parent array is never mutated.
      const childRails =
        depth >= 1 ? [...rails, hasFollowingSibling] : rails
      const placed = visit(
        child,
        depth + 1,
        childRails,
        index < node.children.length - 1
      )
      if (!placed) row.cutChildren += subtreeSize(child)
    })
    return true
  }

  roots.forEach((root, index) => {
    visit(root, 0, [], index < roots.length - 1)
  })

  return {
    rows,
    total,
    shown: rows.length,
    truncated: rows.length < total
  }
}

/**
 * Plan the run graph: the coordinator's spine with one lane pair per row.
 *
 * Only rows from `planGraph` become nodes. A recorded child keeps the lane of
 * its top-level ancestor and the rails the plan already assigned to it; a
 * top-level worker with no recorded parent becomes a member block and gets no
 * rail at all, because the coordinator edge is run membership, not parentage.
 */
export function planRunGraph(roots: TopologyWorker[], limit: number): RunGraphPlan {
  const plan = planGraph(roots, limit)
  const blocks: MemberBlock[] = []
  for (const row of plan.rows) {
    if (row.depth === 0) {
      blocks.push({ node: row.node, children: [], cutChildren: row.cutChildren })
    } else {
      // `planGraph` opens with a depth-0 row, so a child row always has its
      // member block above it.
      const current = blocks[blocks.length - 1] as MemberBlock
      current.children.push(row)
    }
  }
  const rows: RunGraphRow[] = []
  for (let index = 0; index < blocks.length; index += 2) {
    rows.push({
      left: blocks[index] ?? null,
      right: blocks[index + 1] ?? null
    })
  }
  return {
    rows,
    members: blocks.length,
    memberTotal: roots.length,
    total: plan.total,
    shown: plan.shown,
    truncated: plan.truncated
  }
}

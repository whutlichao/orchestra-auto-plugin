// Render plan for the recorded topology graph.
//
// The panel draws nodes as cards and recorded parent edges as connector lines.
// Lines are real elements, not text indentation: a row reserves one rail cell
// per recorded ancestor and a rail is drawn only while that ancestor still has a
// later sibling, so a trunk ends where its branch ends.
//
// Two kinds of edge are deliberately absent:
//
// - the run (coordinator) to a worker: no `parent_worker_id` was recorded, so a
//   top-level row gets no incoming tick at all;
// - a top-level worker to its siblings: they share no recorded parent, so the
//   first rail level belongs to children of depth-1 workers, never to them.
//
// This module only decides which rows fit the render budget. It never adds a
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

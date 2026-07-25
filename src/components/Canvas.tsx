import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useStoreApi,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import TableNode from './nodes/TableNode';
import FilterNode from './nodes/FilterNode';
import OutputNode from './nodes/OutputNode';
import { getTables, getTableColumns, executeQuery } from '../lib/db';
import type { PresetData } from '../types';

const nodeTypes: NodeTypes = {
  tableNode: TableNode,
  filterNode: FilterNode,
  outputNode: OutputNode,
};

const initialNodes: Node[] = [
  {
    id: 'table-1',
    type: 'tableNode',
    position: { x: 250, y: 50 },
    data: { selectedTable: '', tables: [], columns: [] },
  },
  {
    id: 'filter-1',
    type: 'filterNode',
    position: { x: 220, y: 280 },
    data: {
      filterColumn: '',
      filterOp: '=',
      filterValue: '',
      customSql: '',
      columns: [],
    },
  },
  {
    id: 'output-1',
    type: 'outputNode',
    position: { x: 220, y: 520 },
    data: { columns: [], rows: [], loading: false, error: null },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e-table-filter',
    source: 'table-1',
    target: 'filter-1',
    animated: true,
    style: { stroke: '#5b6abf' },
  },
  {
    id: 'e-filter-output',
    source: 'filter-1',
    target: 'output-1',
    animated: true,
    style: { stroke: '#5b6abf' },
  },
];

interface CanvasProps {
  isConnected: boolean;
}

function CanvasInner({ isConnected }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [tableList, setTableList] = useState<string[]>([]);
  const [queryTrigger, setQueryTrigger] = useState(0);

  const counterRef = useRef(2);
  const tableListRef = useRef<string[]>([]);
  tableListRef.current = tableList;

  const containerRef = useRef<HTMLDivElement>(null);
  const queryParamsRef = useRef({ selectedTable: '', filterColumn: '', filterOp: '=', filterValue: '', customSql: '' });

  const storeApi = useStoreApi();
  const [contextMenu, setContextMenu] = useState<{ px: number; py: number; fx: number; fy: number; type: 'node'; nodeId: string } | { px: number; py: number; fx: number; fy: number; type: 'pane' } | null>(null);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeMenu();
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu, closeMenu]);

  const clientToFlow = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const relX = clientX - (rect?.left || 0);
    const relY = clientY - (rect?.top || 0);
    const t = storeApi.getState().transform;
    return {
      x: (relX - t[0]) / t[2],
      y: (relY - t[1]) / t[2],
    };
  }, [storeApi]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const px = event.clientX - (rect?.left || 0);
    const py = event.clientY - (rect?.top || 0);
    const fp = clientToFlow(event.clientX, event.clientY);
    setContextMenu({ px, py, fx: fp.x, fy: fp.y, type: 'node', nodeId: node.id });
  }, [clientToFlow]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const e = event as React.MouseEvent;
    const rect = containerRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left || 0);
    const py = e.clientY - (rect?.top || 0);
    const fp = clientToFlow(e.clientX, e.clientY);
    setContextMenu({ px, py, fx: fp.x, fy: fp.y, type: 'pane' });
  }, [clientToFlow]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: '#5b6abf' } }, eds));
    },
    [setEdges]
  );

  useEffect(() => {
    if (!isConnected) return;
    getTables().then((tables) => {
      setTableList(tables);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === 'table-1' ? { ...n, data: { ...n.data, tables, columns: [] } } : n
        )
      );
    });
  }, [isConnected, setNodes]);

  const addTableNode = useCallback((x?: number, y?: number) => {
    counterRef.current += 1;
    const id = `table-${counterRef.current}`;
    const newNode: Node = {
      id,
      type: 'tableNode',
      position: { x: x ?? 250, y: y ?? 50 },
      data: { selectedTable: '', tables: tableListRef.current, columns: [] },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const addFilterNode = useCallback((x?: number, y?: number) => {
    counterRef.current += 1;
    const id = `filter-${counterRef.current}`;
    const newNode: Node = {
      id,
      type: 'filterNode',
      position: { x: x ?? 220, y: y ?? 280 },
      data: {
        filterColumn: '',
        filterOp: '=',
        filterValue: '',
        customSql: '',
        columns: [],
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const addOutputNode = useCallback((x?: number, y?: number) => {
    counterRef.current += 1;
    const id = `output-${counterRef.current}`;
    const newNode: Node = {
      id,
      type: 'outputNode',
      position: { x: x ?? 220, y: y ?? 520 },
      data: { columns: [], rows: [], loading: false, error: null },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const clearNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          if (n.type === 'tableNode') return { ...n, data: { ...n.data, selectedTable: '', columns: [] } };
          if (n.type === 'filterNode') return { ...n, data: { ...n.data, filterColumn: '', filterOp: '=', filterValue: '', customSql: '' } };
          return n;
        })
      );
    },
    [setNodes]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges]
  );

  // Stable handler implementations stored in refs — never trigger re-renders
  const handleTableChangeRef = useRef<(nodeId: string, table: string) => void>(() => {});
  const handleFilterChangeRef = useRef<(nodeId: string, column: string, op: string, value: string) => void>(() => {});
  const handleCustomSqlChangeRef = useRef<(nodeId: string, sql: string) => void>(() => {});

  handleTableChangeRef.current = async (nodeId: string, table: string) => {
    const columns = await getTableColumns(table);
    queryParamsRef.current = { ...queryParamsRef.current, selectedTable: table };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) return { ...n, data: { ...n.data, selectedTable: table, tables: tableListRef.current, columns } };
        if (n.id === 'output-1') return { ...n, data: { ...n.data, columns: [], rows: [], loading: false, error: null } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  handleFilterChangeRef.current = (nodeId: string, column: string, op: string, value: string) => {
    queryParamsRef.current = { ...queryParamsRef.current, filterColumn: column, filterOp: op, filterValue: value, customSql: '' };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) return { ...n, data: { ...n.data, filterColumn: column, filterOp: op, filterValue: value, customSql: '' } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  handleCustomSqlChangeRef.current = (nodeId: string, sql: string) => {
    queryParamsRef.current = { ...queryParamsRef.current, customSql: sql };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) return { ...n, data: { ...n.data, customSql: sql } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  // Stable callback stubs per node — refs ensure the onTableChange/onFilterChange
  // references stay stable so node components don't re-render unnecessarily
  const tableCallbacksRef = useRef<Map<string, (table: string) => void>>(new Map());
  const filterCallbacksRef = useRef<Map<string, (column: string, op: string, value: string) => void>>(new Map());
  const customSqlCallbacksRef = useRef<Map<string, (sql: string) => void>>(new Map());

  // Inject stable callbacks + tables into all nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type === 'tableNode') {
          if (!tableCallbacksRef.current.has(n.id)) {
            tableCallbacksRef.current.set(n.id, (table: string) => handleTableChangeRef.current(n.id, table));
          }
          return { ...n, data: { ...n.data, onTableChange: tableCallbacksRef.current.get(n.id)!, onDelete: removeNode } };
        }
        if (n.type === 'filterNode') {
          if (!filterCallbacksRef.current.has(n.id)) {
            filterCallbacksRef.current.set(n.id, (c: string, o: string, v: string) => handleFilterChangeRef.current(n.id, c, o, v));
          }
          if (!customSqlCallbacksRef.current.has(n.id)) {
            customSqlCallbacksRef.current.set(n.id, (s: string) => handleCustomSqlChangeRef.current(n.id, s));
          }
          return {
            ...n,
            data: {
              ...n.data,
              onFilterChange: filterCallbacksRef.current.get(n.id)!,
              onCustomSqlChange: customSqlCallbacksRef.current.get(n.id)!,
              onDelete: removeNode,
            },
          };
        }
        return n;
      })
    );
  }, [tableList, setNodes, removeNode]);

  // When edges change, sync queryParamsRef from the connected nodes' data
  useEffect(() => {
    const filterEdge = edges.find((e) => e.target === 'output-1');
    if (!filterEdge) return;
    const filterNode = nodes.find((n) => n.id === filterEdge.source);
    if (!filterNode || filterNode.type !== 'filterNode') return;
    const tableEdge = edges.find((e) => e.target === filterNode.id);
    if (!tableEdge) return;
    const tableNode = nodes.find((n) => n.id === tableEdge.source);
    if (!tableNode || tableNode.type !== 'tableNode') return;

    const fdata = filterNode.data as Record<string, unknown>;
    const tdata = tableNode.data as Record<string, unknown>;
    queryParamsRef.current = {
      selectedTable: (tdata.selectedTable as string) || '',
      filterColumn: (fdata.filterColumn as string) || '',
      filterOp: (fdata.filterOp as string) || '=',
      filterValue: (fdata.filterValue as string) || '',
      customSql: (fdata.customSql as string) || '',
    };
  }, [edges, nodes]);

  // Auto-run query when output node has incoming edge
  useEffect(() => {
    const filterEdge = edges.find((e) => e.target === 'output-1');
    if (!filterEdge) return;
    const tableEdge = edges.find((e) => e.target === filterEdge.source);
    if (!tableEdge) return;

    const { selectedTable, filterColumn, filterOp, filterValue, customSql } = queryParamsRef.current;
    if (!selectedTable) return;

    let query = `SELECT * FROM "${selectedTable}"`;

    const esc = (s: string) => s.replace(/'/g, "''");
    if (customSql?.trim()) {
      query += ` WHERE ${customSql.trim()}`;
    } else if (filterColumn) {
      if (['IS NULL', 'IS NOT NULL'].includes(filterOp)) {
        query += ` WHERE "${filterColumn}" ${filterOp}`;
      } else if (filterOp === 'IN') {
        query += ` WHERE "${filterColumn}" IN (${filterValue})`;
      } else if (filterOp === 'LIKE') {
        query += ` WHERE "${filterColumn}" LIKE '%${esc(filterValue)}%'`;
      } else if (filterOp === 'NOT LIKE') {
        query += ` WHERE "${filterColumn}" NOT LIKE '%${esc(filterValue)}%'`;
      } else {
        query += ` WHERE "${filterColumn}" ${filterOp} '${esc(filterValue)}'`;
      }
    }

    query += ' LIMIT 200';

    setNodes((nds) =>
      nds.map((n) => (n.id === 'output-1' ? { ...n, data: { ...n.data, columns: [], rows: [], loading: true, error: null } } : n))
    );

    const timeout = setTimeout(async () => {
      try {
        const result = await executeQuery(query);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === 'output-1'
              ? { ...n, data: { ...n.data, columns: result.columns, rows: result.rows, loading: false, error: null } }
              : n
          )
        );
      } catch (err) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === 'output-1' ? { ...n, data: { ...n.data, columns: [], rows: [], loading: false, error: String(err) } } : n
          )
        );
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [edges, queryTrigger, setNodes]);

  const handleLoadPreset = useCallback(
    async (preset: PresetData) => {
      const tables = await getTables();
      setTableList(tables);
      const nodesWithHandlers = (preset.nodes as Node[]).map((n) => {
        if (n.type === 'tableNode') {
          if (!tableCallbacksRef.current.has(n.id)) {
            tableCallbacksRef.current.set(n.id, (table: string) => handleTableChangeRef.current(n.id, table));
          }
          return { ...n, data: { ...n.data, onTableChange: tableCallbacksRef.current.get(n.id)!, onDelete: removeNode } };
        }
        if (n.type === 'filterNode') {
          if (!filterCallbacksRef.current.has(n.id)) {
            filterCallbacksRef.current.set(n.id, (c: string, o: string, v: string) => handleFilterChangeRef.current(n.id, c, o, v));
          }
          if (!customSqlCallbacksRef.current.has(n.id)) {
            customSqlCallbacksRef.current.set(n.id, (s: string) => handleCustomSqlChangeRef.current(n.id, s));
          }
          return {
            ...n,
            data: {
              ...n.data,
              onFilterChange: filterCallbacksRef.current.get(n.id)!,
              onCustomSqlChange: customSqlCallbacksRef.current.get(n.id)!,
              onDelete: removeNode,
            },
          };
        }
        return n;
      });
      setNodes(nodesWithHandlers);
      setEdges(preset.edges as Edge[]);
    },
    [setNodes, setEdges, removeNode]
  );

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__canvasLoadPreset = handleLoadPreset;
    w.__canvasGetNodes = () => nodes;
    w.__canvasGetEdges = () => edges;
  }, [handleLoadPreset, nodes, edges]);

  return (
    <div ref={containerRef} className="h-full w-full relative">
      {contextMenu && (() => {
        const pos = contextMenu;
        return (
          <div
            className="absolute z-20 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: pos.px, top: pos.py }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {pos.type === 'node' ? (
              <>
                <button
                  onClick={() => { clearNode(pos.nodeId); closeMenu(); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors"
                >
                  Clear Node
                </button>
                <button
                  onClick={() => { removeNode(pos.nodeId); closeMenu(); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-error hover:bg-bg-hover transition-colors"
                >
                  Delete Node
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => { addTableNode(pos.fx, pos.fy); closeMenu(); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors"
                >
                  Add Table
                </button>
                <button
                  onClick={() => { addFilterNode(pos.fx, pos.fy); closeMenu(); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors"
                >
                  Add Filter
                </button>
                <button
                  onClick={() => { addOutputNode(pos.fx, pos.fy); closeMenu(); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors"
                >
                  Add Output
                </button>
              </>
            )}
          </div>
        );
      })()}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{ animated: true, style: { stroke: '#5b6abf' } }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#363b4e" gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeColor="#242835"
          maskColor="rgba(15, 17, 23, 0.8)"
          style={{ width: 120, height: 80 }}
        />
      </ReactFlow>
    </div>
  );
}

export default function Canvas({ isConnected }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner isConnected={isConnected} />
    </ReactFlowProvider>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
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

  // Stable refs for handlers so node data injection doesn't cause re-render loops
  const handleTableChangeRef = useRef<(table: string) => void>(() => {});
  const handleFilterChangeRef = useRef<(column: string, op: string, value: string) => void>(() => {});
  const handleCustomSqlChangeRef = useRef<(sql: string) => void>(() => {});
  const queryParamsRef = useRef({ selectedTable: '', filterColumn: '', filterOp: '=', filterValue: '', customSql: '' });

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

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: '#5b6abf' } }, eds));
    },
    [setEdges]
  );

  // Stable handler implementations — stored in refs, never trigger re-renders
  handleTableChangeRef.current = async (table: string) => {
    const columns = await getTableColumns(table);
    queryParamsRef.current = { ...queryParamsRef.current, selectedTable: table };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'table-1') return { ...n, data: { ...n.data, selectedTable: table, tables: tableList, columns } };
        if (n.id === 'filter-1') return { ...n, data: { ...n.data, columns: columns.map((c) => c.name) } };
        if (n.id === 'output-1') return { ...n, data: { ...n.data, columns: [], rows: [], loading: false, error: null } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  handleFilterChangeRef.current = (column: string, op: string, value: string) => {
    queryParamsRef.current = { ...queryParamsRef.current, filterColumn: column, filterOp: op, filterValue: value, customSql: '' };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'filter-1') return { ...n, data: { ...n.data, filterColumn: column, filterOp: op, filterValue: value, customSql: '' } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  handleCustomSqlChangeRef.current = (sql: string) => {
    queryParamsRef.current = { ...queryParamsRef.current, customSql: sql };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'filter-1') return { ...n, data: { ...n.data, customSql: sql } };
        return n;
      })
    );
    setQueryTrigger((v) => v + 1);
  };

  // Inject stable refs into node data ONCE (initial + tableList change)
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'table-1') {
          return { ...n, data: { ...n.data, onTableChange: (t: string) => handleTableChangeRef.current(t) } };
        }
        if (n.id === 'filter-1') {
          return {
            ...n,
            data: {
              ...n.data,
              onFilterChange: (c: string, o: string, v: string) => handleFilterChangeRef.current(c, o, v),
              onCustomSqlChange: (s: string) => handleCustomSqlChangeRef.current(s),
            },
          };
        }
        return n;
      })
    );
  }, [tableList, setNodes]);

  // Auto-run query when output node has incoming edge
  useEffect(() => {
    const hasConnection = edges.some((e) => e.target === 'output-1' && e.source === 'filter-1');
    if (!hasConnection) return;

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
        if (n.id === 'table-1') {
          return { ...n, data: { ...n.data, onTableChange: (t: string) => handleTableChangeRef.current(t) } };
        }
        if (n.id === 'filter-1') {
          return {
            ...n,
            data: {
              ...n.data,
              onFilterChange: (c: string, o: string, v: string) => handleFilterChangeRef.current(c, o, v),
              onCustomSqlChange: (s: string) => handleCustomSqlChangeRef.current(s),
            },
          };
        }
        return n;
      });
      setNodes(nodesWithHandlers);
      setEdges(preset.edges as Edge[]);
    },
    [setNodes, setEdges]
  );

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__canvasLoadPreset = handleLoadPreset;
    w.__canvasGetNodes = () => nodes;
    w.__canvasGetEdges = () => edges;
  }, [handleLoadPreset, nodes, edges]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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

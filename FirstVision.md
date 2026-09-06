# System Context & Architecture
You are an expert full-stack desktop app developer using Electron/Tauri v2, React, Tailwind CSS, and React Flow. 
We are building a lightweight, desktop-only local database GUI and query visualizer.

## Core Requirements & Features
1. Local Database Reader:
   - Allow the user to select a local SQLite file (`.db` or `.sqlite`) via a native file picker.
   - Parse the schema (tables, columns, data types) and display a schema explorer in a collapsible sidebar.
   - Execute raw SQL queries (SELECT, INSERT, UPDATE, DELETE) against the local DB file safely.

2. Visual Canvas & Query Engine:
   - Integrate React Flow to create an interactive, infinite canvas (pan, zoom, drag).
   - Create custom React Flow nodes for:
     a) Table Selection Node (dropdown to pick a table from the connected DB).
     b) Filter/Query Node (GUI controls for ADD, SUBTRACT, WHERE clauses, or custom SQL).
     c) Data Output Node (renders query results in a clean Tailwind data grid/table).
   - Wire connections so that data flows from Table Node -> Filter Node -> Output Node.

3. Query Presets (Local Persistence):
   - Allow users to save current canvas node layouts and query states as a JSON preset file locally.
   - Provide a "Preset Manager" sidebar to load, save, rename, and delete saved canvas layouts.

4. Design & Performance:
   - Clean, modern dark-mode UI using Tailwind CSS.
   - Smooth canvas performance with zero cloud/network dependencies (100% offline/local).

## Project Setup Instructions
Please help me step-by-step:
1. Initialize the project scaffolding with React, Tailwind CSS, and Lucide icons.
2. Set up the local database driver and file selector.
3. Build the React Flow canvas components and custom node types.
4. Implement local JSON saving/loading for query presets.

Let's start with Step 1: Create the basic file layout and native file-picker logic to open a local SQLite database.
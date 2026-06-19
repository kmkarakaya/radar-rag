# RAG Admin Panel Detailed Specification

## 1. Overview
The goal is to replace the existing simplistic admin page with a state-aware "Operations Dashboard". The UI will act as a control plane for the RAG backend, allowing for full lifecycle management of collections and system diagnostics.

## 2. Architecture & Layout
**Tech Stack**: HTML5, Tailwind CSS, Vanilla JavaScript.
**Navigation**: Sidebar-driven layout.
- **Collections View**: Main grid of RAG collections.
- **Job Monitor View**: Real-time tracking of indexing jobs.
- **System Health View**: Diagnostic dashboard for system dependencies.

## 3. Functional Modules

### 3.1 Collections Management
**A. Collection Grid**
- **Data Source**: `GET /v1/rag/collections`
- **Visuals**: Cards or table rows showing: `displayName`, `status` (badge), `chunkCount`, and `updatedAt`.
- **Actions**: "Inspect" (opens Inspector), "Delete" (triggers confirmation $\rightarrow$ `DELETE /v1/admin/collections/:id`).

**B. The Inspector (Slide-out Panel)**
- **Header**: Collection name and "Quick Actions" (Re-index, Delete).
- **Readiness Section**: 
    - Calls `GET /v1/rag/collections/:id/ready`.
    - **Logic**: If `capabilities.query` is false, display the list of `blockers`. Use a Red/Yellow/Green indicator for Chroma, Ollama, and Model alignment.
- **Playground**:
    - **Retrieve Tab**: Input $\rightarrow$ `POST /v1/rag/collections/:id/retrieve`. Display sources in a list.
    - **Query Tab**: Input $\rightarrow$ `POST /v1/rag/collections/:id/query`. Display formatted answer and citations.
- **Editor Tab**:
    - **Fields**: Map all fields from `updateCollectionSchema` in `adminRouter.ts`.
    - **Logic**: `PATCH /v1/admin/collections/:id`.
    - **Validation**: Client-side check for required fields (`displayName`) before submission.

### 3.2 Job Monitor
- **Data Source**: Polling `GET /v1/admin/jobs/:id` for all jobs associated with the current session.
- **UI Elements**: 
    - Progress bar (simulated or based on job status).
    - Status badges: `queued`, `running`, `completed`, `failed`.
    - **Cancel Button**: Maps to `POST /v1/admin/jobs/:id/cancel`.
- **Trigger**: `POST /v1/admin/collections/:id/reindex` immediately adds the new job to this view.

### 3.3 System Health Dashboard
- **Global Health**: `GET /health` $\rightarrow$ Simple OK/Error status.
- **System Readiness**: `GET /ready` $\rightarrow$ 
    - Display `overallSummary`.
    - List `recommendedActions` as a checklist for the admin.
    - Display dependency status: Registry, Chroma, Ollama.

## 4. Technical Mapping Table

| UI Action | API Endpoint | Method | Expected Payload / Context |
| :--- | :--- | :--- | :--- |
| List Collections | `/v1/rag/collections` | GET | N/A |
| Create Collection | `/v1/admin/collections` | POST | `createCollectionSchema` |
| Update Collection | `/v1/admin/collections/:id` | PATCH | `updateCollectionSchema` |
| Delete Collection | `/v1/admin/collections/:id` | DELETE | N/A |
| Trigger Re-index | `/v1/admin/collections/:id/reindex` | POST | N/A |
| Check Job Status | `/v1/admin/jobs/:id` | GET | N/A |
| Cancel Job | `/v1/admin/jobs/:id/cancel` | POST | N/A |
| Test Retrieval | `/v1/rag/collections/:id/retrieve` | POST | `{ question, k }` |
| Test Query | `/v1/rag/collections/:id/query` | POST | `{ question }` |
| System Readiness | `/ready` | GET | Optional: `details=true` |

## 5. UX & Interaction Design
- **Loading States**: All API-driven components must show a skeleton or spinner during fetch.
- **Toast Feedback**: 
    - Success: "Collection created successfully."
    - Error: Render the `issues` array from Zod `INVALID_REQUEST_BODY` errors as a list of bullet points.
- **Readiness-Driven UI**: 
    - The "Query" button in the Playground is `disabled` if `capabilities.query === false`.
    - A tooltip next to the disabled button explains the specific blocker (e.g., "Embedding model not found in Ollama").

## 6. Implementation Phases
1. **Phase 1**: Layout Shell & Navigation.
2. **Phase 2**: Collections CRUD & Tabbed Editor.
3. **Phase 3**: Readiness Integration & Playground.
4. **Phase 4**: Job Monitor & System Health.
5. **Phase 5**: Polishing, Toasts, and Error Handling.

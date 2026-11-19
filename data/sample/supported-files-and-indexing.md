# Supported files and indexing

## Which file formats can I index?

RAGStation indexes these file types:

- Plain text (.txt)
- Markdown (.md)
- PDF (.pdf) with a text layer; scanned images without text are not read
- Word documents (.doc and .docx)

Other files in the folder are skipped and reported as unsupported. Hidden files and node_modules folders are ignored.

## Where do my documents go?

Create a collection and upload its documents: in the admin panel, drop the files into the collection's Documents tab; over the API, send them to POST /v1/admin/collections/<collection-id>/files. Each collection keeps its uploaded documents in its own folder, data/collections/<collection-id>. As an advanced option, a collection can instead read a folder on the server, for example data/my-docs (with Docker, ./data/my-docs next to docker-compose.yml), including its subfolders.

## When do I need to re-index?

Indexing reads the documents once. Re-index a collection after you upload or replace documents (a deleted document leaves the search results right away), or after you change its chunking or embedding settings. Re-indexing builds a new index in the background; searches keep using the previous index until the new one is ready, so there is no downtime.

## How long does indexing take?

Small folders take seconds. The first indexing with the built-in embedding model also downloads the model (about 350 MB) once. The built-in model runs on the CPU; for large document sets, an external embedding service such as Ollama or a cloud API is faster.

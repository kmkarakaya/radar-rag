# Supported files and indexing

## Which file formats can I index?

Radar RAG indexes these file types:

- Plain text (.txt)
- Markdown (.md)
- PDF (.pdf) with a text layer; scanned images without text are not read
- Word documents (.doc and .docx)

Other files in the folder are skipped and reported as unsupported. Hidden files and node_modules folders are ignored.

## Where do my documents go?

Each collection reads one source folder, including its subfolders. With Docker, put your documents in a folder under ./data next to docker-compose.yml, for example ./data/my-docs, and create a collection with the source path data/my-docs in the admin panel.

## When do I need to re-index?

Indexing reads the folder once. Re-index a collection after you add, change or delete files, or after you change its chunking or embedding settings. Re-indexing builds a new index in the background; searches keep using the previous index until the new one is ready, so there is no downtime.

## How long does indexing take?

Small folders take seconds. The first indexing with the built-in embedding model also downloads the model (about 350 MB) once. The built-in model runs on the CPU; for large document sets, an external embedding service such as Ollama or a cloud API is faster.

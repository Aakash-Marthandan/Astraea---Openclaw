import os
import sys
import subprocess

def install_and_import(package):
    try:
        import importlib
        importlib.import_module(package)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
    finally:
        globals()[package] = __import__(package)

install_and_import('PyPDF2')
import PyPDF2

doc_folder = r"C:\UseClawX\Documentation"
docs = ['Astraea Engine.pdf', 'Execution Plan Phase 1.pdf', 'HRRN.pdf', 'HRRN_Overview.pdf', 'System 2 Cognitive Architecture.pdf']

out_file = "c:\\UseClawX\\system2-openclaw-deployment\\pdf_output.txt"
with open(out_file, "w", encoding="utf-8") as out_txt:
    for doc in docs:
        path = os.path.join(doc_folder, doc)
        out_txt.write(f"\n--- {doc} ---\n")
        try:
            with open(path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                text = ""
                for page in reader.pages:
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
                out_txt.write(text[:3000] + "\n")
        except Exception as e:
            out_txt.write(f"Error reading {doc}: {e}\n")

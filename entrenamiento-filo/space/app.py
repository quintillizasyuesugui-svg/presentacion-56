# Filo piensa: la IA entrenada en Colab, servida en un Space gratis de Hugging Face.
# Recibe lo que oyó el celular y contesta con órdenes cortas de la lista de Conexiones
# («vol.bajar 10 ; diap.siguiente») o «nada». No hace nada por su cuenta: el celular revisa la
# respuesta y sólo cumple órdenes de su lista.
import os
import re
import time
import unicodedata

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import hf_hub_download
from llama_cpp import Llama
from pydantic import BaseModel

MODELO = os.environ.get("MODELO", "")
ARCHIVO = os.environ.get("ARCHIVO", "filo.gguf")

ruta = hf_hub_download(MODELO, ARCHIVO)
llm = Llama(model_path=ruta, n_ctx=256, n_threads=2, n_batch=64, verbose=False)

app = FastAPI()
# Sólo la página de Conexiones (y las pruebas en la PC) pueden preguntarle.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://presentacion-56\.onrender\.com|http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Pedido(BaseModel):
    frase: str


# Igual que normalizar() de filo-piensa.js: sin tildes ni signos (la ñ queda n), como se entrenó.
def limpiar(texto: str) -> str:
    texto = unicodedata.normalize("NFD", texto.lower())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()[:200]


def pensar(frase: str) -> str:
    salida = llm(
        f"Orden: {frase}\nFilo:",
        max_tokens=40,
        temperature=0,
        stop=["\n", "<|endoftext|>", "<|im_end|>"],
    )
    return salida["choices"][0]["text"].strip()


# Se calienta al arrancar: la primera pregunta de verdad ya sale rápida.
pensar("siguiente")


@app.get("/")
def salud():
    return {"ok": True}


@app.post("/pensar")
def pedir(pedido: Pedido):
    frase = limpiar(pedido.frase)
    if not frase:
        return {"respuesta": "nada", "ms": 0}
    inicio = time.time()
    respuesta = pensar(frase)
    return {"respuesta": respuesta, "ms": round((time.time() - inicio) * 1000)}

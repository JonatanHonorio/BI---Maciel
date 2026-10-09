#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Transcreve audio (.ogg do WhatsApp, .mp3, .m4a, .wav) localmente, sem mandar
nada pra fora. Util porque a Tatiane, a Mayra e as gerentes mandam observacao
por audio e isso precisa virar texto pra entrar na analise.

O audio e decodificado pelo ffmpeg, nao pelo PyAV que o faster-whisper usa por
padrao: a versao do `av` instalada aqui quebra com `metadata_errors` e, de
qualquer forma, o ffmpeg ja esta na maquina e aceita tudo que o WhatsApp manda.
Passamos o numpy array pronto, entao a lib nem tenta decodificar.

Modelo "small" por padrao: em portugues o "base" troca numero e nome proprio,
que e exatamente o que mais importa nessas mensagens. Baixa uma vez (~500 MB)
e fica em cache em ~/.cache/huggingface.

Uso:  python scripts/transcreve-audio.py <arquivo-ou-pasta> [--modelo small]
"""
import sys, os, glob, subprocess, shutil
import numpy as np

EXTS = (".ogg", ".opus", ".mp3", ".m4a", ".wav", ".aac", ".flac")
FFMPEG = shutil.which("ffmpeg") or os.path.expanduser(
    "~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    "/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe")

def alvos(caminho):
    if os.path.isdir(caminho):
        achados = []
        for e in EXTS:
            achados += glob.glob(os.path.join(caminho, "*" + e))
        return sorted(achados)
    return [caminho]

def carrega(path):
    """16 kHz mono float32, que e o que o Whisper espera."""
    p = subprocess.run(
        [FFMPEG, "-nostdin", "-threads", "0", "-i", path,
         "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", "16000", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou em {path}: {p.stderr.decode('utf-8','ignore')[-400:]}")
    return np.frombuffer(p.stdout, np.int16).astype(np.float32) / 32768.0

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    caminho = sys.argv[1]
    modelo = sys.argv[sys.argv.index("--modelo") + 1] if "--modelo" in sys.argv else "small"

    arquivos = alvos(caminho)
    if not arquivos:
        print(f"nenhum audio em {caminho}"); sys.exit(1)

    from faster_whisper import WhisperModel
    # int8 na CPU: sem GPU aqui, e a diferenca e irrelevante pra fala de celular.
    m = WhisperModel(modelo, device="cpu", compute_type="int8")

    for f in arquivos:
        print(f"\n{'='*70}\n{os.path.basename(f)}\n{'='*70}", flush=True)
        try:
            audio = carrega(f)
        except Exception as e:
            print(f"  ERRO: {e}"); continue
        segs, info = m.transcribe(audio, language="pt", vad_filter=True,
                                  beam_size=5, condition_on_previous_text=False)
        print(f"[{info.duration:.0f}s]\n", flush=True)
        for s in segs:
            print(f"  [{int(s.start//60):02d}:{int(s.start%60):02d}] {s.text.strip()}", flush=True)

if __name__ == "__main__":
    main()

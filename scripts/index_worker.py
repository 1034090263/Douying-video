"""在 IndexTTS2 的虚拟环境里运行：一次加载模型，批量合成 jobs.json 里的句子。

由 scripts/tts.py 调用，不需要手动运行。
jobs.json: [{"text": ..., "out": ..., "emo_vector": [8 个数] 或 "emo_text": ..., "emo_alpha": ...}, ...]
"""
import json
import sys
import time

from indextts.infer_v2 import IndexTTS2


def main():
    jobs_path, voice = sys.argv[1], sys.argv[2]
    jobs = json.load(open(jobs_path))
    tts = IndexTTS2(cfg_path="checkpoints/config.yaml", model_dir="checkpoints", use_fp16=True, use_cuda_kernel=False)
    for i, job in enumerate(jobs):
        t0 = time.time()
        emo = job.get("emo_text")
        tts.infer(
            spk_audio_prompt=voice,
            text=job["text"],
            output_path=job["out"],
            emo_vector=job.get("emo_vector"),
            use_emo_text=bool(emo),
            emo_text=emo,
            emo_alpha=job.get("emo_alpha", 0.6),
            use_random=False,
            verbose=False,
        )
        print(f"[{i + 1}/{len(jobs)}] {time.time() - t0:4.1f}s  {job['text']}", flush=True)


if __name__ == "__main__":
    main()

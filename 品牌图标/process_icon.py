# -*- coding: utf-8 -*-
"""预约教室助手图标处理：白底抠图(flood-fill 保内部白色符号) + 羽化边缘 + 裁边 + 多尺寸压缩。"""
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = r"品牌图标\raw_icon.jpg"
OUT = r"品牌图标"
THRESH = 40  # 与纯白的颜色距离阈值；背景纯白 << 40，徽章蓝色 >> 40
PADDING = 0.10  # 内容外留白比例


def main():
    src = Image.open(SRC).convert("RGB")
    a = np.asarray(src).astype(np.float32)  # H,W,3；float 避免 int16 平方溢出
    dist = np.sqrt(((a - 255.0) ** 2).sum(axis=2))  # H,W
    H, W = dist.shape

    # 从四条边 flood-fill：只吃掉"与边缘连通的近白背景"，内部白色符号不动
    visited = np.zeros((H, W), bool)
    q = deque()
    for i in range(H):
        for j in (0, W - 1):
            if dist[i, j] < THRESH and not visited[i, j]:
                visited[i, j] = True
                q.append((i, j))
    for j in range(W):
        for i in (0, H - 1):
            if dist[i, j] < THRESH and not visited[i, j]:
                visited[i, j] = True
                q.append((i, j))
    while q:
        i, j = q.popleft()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < H and 0 <= nj < W and not visited[ni, nj] and dist[ni, nj] < THRESH:
                visited[ni, nj] = True
                q.append((ni, nj))

    alpha = np.where(visited, 0, 255).astype(np.uint8)
    # 羽化边缘（抗锯齿，约 1px 过渡）
    alpha_im = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0))
    r, g, b = src.split()
    rgba = Image.merge("RGBA", (r, g, b, alpha_im))

    # 按内容 bounding box 裁边，再扩成正方形并加留白
    ys, xs = np.where(np.asarray(alpha_im) > 8)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    content = rgba.crop((x0, y0, x1 + 1, y1 + 1))
    cw, ch = content.size
    side = max(cw, ch)
    pad = int(side * PADDING)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(content, ((side + pad * 2 - cw) // 2, (side + pad * 2 - ch) // 2), content)
    canvas = canvas.convert("RGBA")

    sizes = [512, 128, 64]
    for s in sizes:
        p = os.path.join(OUT, f"icon_{s}.png")
        canvas.resize((s, s), Image.LANCZOS).save(p, "PNG", optimize=True)
        print(p, os.path.getsize(p), "bytes")
    # WebP 更小的存储版（透明底）
    wp = os.path.join(OUT, "icon_512.webp")
    canvas.resize((512, 512), Image.LANCZOS).save(wp, "WEBP", quality=88, method=6)
    print(wp, os.path.getsize(wp), "bytes")


if __name__ == "__main__":
    main()

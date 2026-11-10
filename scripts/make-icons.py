"""Regenerate build/icon.png and build/icon.ico from build/icon-source.* or build/icon.png."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"


def find_source() -> Path:
    for name in ("icon-source.png", "icon-source.jpg", "icon.png"):
        candidate = BUILD / name
        if candidate.exists():
            return candidate
    raise SystemExit(f"No icon source found under {BUILD}")


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    src = find_source()
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize(
        (1024, 1024), Image.Resampling.LANCZOS
    )

    png_path = BUILD / "icon.png"
    img.save(png_path, format="PNG", optimize=True)
    print(f"Wrote {png_path} {img.size}")

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_imgs = [img.resize(s, Image.Resampling.LANCZOS) for s in sizes]
    ico_path = BUILD / "icon.ico"
    ico_imgs[0].save(ico_path, format="ICO", sizes=sizes, append_images=ico_imgs[1:])
    print(f"Wrote {ico_path}")

    desktop = ROOT / "desktop"
    img.save(desktop / "icon.png", format="PNG", optimize=True)
    ico_imgs[0].save(
        desktop / "icon.ico", format="ICO", sizes=sizes, append_images=ico_imgs[1:]
    )
    print("Synced desktop/icon.png and desktop/icon.ico")


if __name__ == "__main__":
    main()

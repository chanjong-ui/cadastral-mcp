#!/usr/bin/env python3
"""
DXF 파일 안의 특정 블록 참조(INSERT)에 AutoCAD XCLIP(SPATIAL_FILTER)을 적용한다.
ezdxf(mozman/ezdxf, MIT License)의 XClip API를 그대로 사용 — 직접 그룹코드를 짜지 않는다.

사용법:
  python apply_xclip.py <dxf파일경로> <블록이름> <minX> <minY> <maxX> <maxY>

<dxf파일경로>는 제자리에서 덮어쓴다.
"""
import sys

def main() -> int:
    if len(sys.argv) != 7:
        print("usage: apply_xclip.py <dxf_path> <block_name> <minX> <minY> <maxX> <maxY>", file=sys.stderr)
        return 2

    dxf_path, block_name = sys.argv[1], sys.argv[2]
    min_x, min_y, max_x, max_y = (float(v) for v in sys.argv[3:7])

    import ezdxf
    from ezdxf.xclip import XClip

    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    inserts = [e for e in msp if e.dxftype() == "INSERT" and e.dxf.name == block_name]
    if not inserts:
        print(f"error: no INSERT referencing block '{block_name}' found in modelspace", file=sys.stderr)
        return 1

    insert = inserts[0]
    xclip = XClip(insert)
    # INSERT가 (0,0,0)/스케일1/무회전으로 삽입되어 블록좌표=WCS좌표이므로 그대로 사용
    xclip.set_block_clipping_path([
        (min_x, min_y),
        (max_x, min_y),
        (max_x, max_y),
        (min_x, max_y),
    ])

    auditor = doc.audit()
    if auditor.errors:
        for e in auditor.errors:
            print(f"audit error: {e.message}", file=sys.stderr)
        return 1

    doc.saveas(dxf_path)
    print(f"ok: xclip applied to block '{block_name}' in {dxf_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

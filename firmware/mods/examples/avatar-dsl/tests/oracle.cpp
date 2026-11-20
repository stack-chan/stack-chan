// SPDX-License-Identifier: Apache-2.0
// Test adapter. Calls the unmodified pinned upstream decoder/VM/RecordingCanvas.
#include <fstream>
#include <iterator>
#include <iostream>
#include "test_support.hpp"
#include "avatar_vm/vm.hpp"

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    std::ifstream bytecode(argv[1], std::ios::binary);
    std::vector<uint8_t> bytes(std::istreambuf_iterator<char>(bytecode), {});
    auto bc = stackchan::avatar_vm::decode(bytes);
    if (!bc) return 3;
    std::ifstream contexts(argv[2], std::ios::binary);
    float v[41];
    while (contexts.read(reinterpret_cast<char*>(v), sizeof(v))) {
        using namespace stackchan::avatar;
        DrawContext ctx;
        ctx.now_ms = static_cast<uint32_t>(v[3]);
        ctx.breath = v[4]; ctx.eye_open_ratio = v[5];
        ctx.gaze_horizontal = v[6]; ctx.gaze_vertical = v[7];
        ctx.mouth_open_ratio = v[8]; ctx.mouth_form_ratio = v[31];
        ctx.expression = static_cast<Expression>(static_cast<uint8_t>(v[9]));
        ctx.palette = {static_cast<uint16_t>(v[10]), static_cast<uint16_t>(v[11]), static_cast<uint16_t>(v[12]), static_cast<uint16_t>(v[13]), static_cast<uint16_t>(v[14])};
        FaceTuning t;
        t.eye_radius = v[15]; t.eye_off_x = v[16]; t.eye_off_y = v[17];
        t.brow_off_x = v[18]; t.brow_off_y = v[19];
        t.mouth_off_x = v[20]; t.mouth_off_y = v[21];
        t.mouth_min_w = v[22]; t.mouth_max_w = v[23];
        t.mouth_min_h = v[24]; t.mouth_max_h = v[25];
        t.eyebrows_visible = v[26]; t.cheeks_visible = v[27];
        t.cheek_radius = v[28]; t.cheek_off_x = v[29]; t.cheek_off_y = v[30];
        t.accessories = v[32];
        avtest::RecordingCanvas canvas(v[0], v[1], v[2] < 0.9f && v[0] == v[1]);
        stackchan::avatar_vm::Vm vm;
        auto result = vm.run(*bc, canvas, ctx, t);
        if (!result) { std::cerr << stackchan::avatar_vm::to_string(result.error()); return 4; }
        std::cout << '[';
        bool first = true;
        for (const auto& op : canvas.ops) {
            const int id = op.kind == avtest::DrawOp::Kind::FillRect ? 64 : op.kind == avtest::DrawOp::Kind::FillCircle ? 65 : op.kind == avtest::DrawOp::Kind::FillTriangle ? 66 : op.kind == avtest::DrawOp::Kind::BeginGroup ? 69 : 70;
            if (!first) std::cout << ',';
            first = false;
            std::cout << '[' << id << ',' << op.a << ',' << op.b << ',' << op.c << ',' << op.d << ',' << op.e << ',' << op.f << ',' << op.color << ']';
        }
        std::cout << "]\n";
    }
}

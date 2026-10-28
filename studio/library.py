from pathlib import Path
import json
from studio_paths import WORKSPACE, RUNTIME



LIBRARY = Path('A:/ComfyUI_Fresh/models')





def workflow_availability(info):
    local_models = WORKSPACE / "ComfyUI/models"
    downloading = {p.name.split(".aria2",1)[0] for p in local_models.rglob("*.aria2*")}

    def listed(node, field, name):
        if name in downloading:
            return False

        spec = info.get(node, {}).get('input', {}).get('required', {}).get(field, [[]])

        values = spec[1].get('options', []) if spec[0] == 'COMBO' and len(spec) > 1 else spec[0]

        return isinstance(values, list) and name in values



    specs = [

        ('image', 'FLUX.1 Dev FP8', [('UNETLoader', 'unet_name', 'flux1-dev-fp8.safetensors'), ('DualCLIPLoader', 'clip_name1', 'clip_l.safetensors'), ('DualCLIPLoader', 'clip_name2', 't5xxl_fp8_e4m3fn_scaled.safetensors'), ('VAELoader', 'vae_name', 'ae.safetensors')], ['FluxGuidance'], 'Use the native FLUX.1 Dev workflow with FP8 and CPU offloading. These are FLUX.1 weights, not Klein. GPU performance has not been benchmarked here.'),

        ('sdxl', 'SDXL / Juggernaut XL', [('CheckpointLoaderSimple', 'ckpt_name', 'sd_xl_base_1.0.safetensors')], ['KSampler', 'VAEDecode', 'SaveImage'], 'SDXL Base and Juggernaut XL are available. Start with the native SDXL template, batch one, around 1024 pixels. No local render test yet.'),

        ('control', 'SDXL + OpenPose / depth ControlNet', [('CheckpointLoaderSimple', 'ckpt_name', 'sd_xl_base_1.0.safetensors'), ('ControlNetLoader', 'control_net_name', 'OpenPoseXL2.safetensors')], ['ControlNetApplyAdvanced', 'DWPreprocessor'], 'SDXL and OpenPoseXL2 are available, along with depth and tile alternatives. Use matching SDXL control weights. A control workflow still needs configuring.'),

        ('inpaint', 'SDXL masked image-to-image', [('CheckpointLoaderSimple', 'ckpt_name', 'sd_xl_base_1.0.safetensors')], ['VAEEncodeForInpaint', 'KSampler'], 'Basic masked image-to-image can use the existing SDXL checkpoint. This is not a dedicated FLUX Fill model. Mask preparation and compositing still need a workflow.'),

        ('reference', 'SDXL IPAdapter', [('CheckpointLoaderSimple', 'ckpt_name', 'sd_xl_base_1.0.safetensors'), ('CLIPVisionLoader', 'clip_name', 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors')], ['IPAdapterAdvanced'], 'SDXL IPAdapter weights exist in the shared library. Use the matching SDXL adapter and CLIP Vision encoder with the IPAdapter Advanced node.'),

        ('upscale', 'RealESRGAN / UltraSharp', [('UpscaleModelLoader', 'model_name', 'RealESRGAN_x4.pth')], ['ImageUpscaleWithModel', 'LoadImage', 'SaveImage'], 'Native upscaling nodes and RealESRGAN_x4 are available. UltraSharp, AnimeSharp and Remacri are alternatives. Use a tiled upscale workflow; no local render test yet.'),

        ('talk', 'Wan 2.2 S2V FP8', [('UNETLoader', 'unet_name', 'wan2.2_s2v_14B_fp8_scaled.safetensors'), ('CLIPLoader', 'clip_name', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'), ('VAELoader', 'vae_name', 'wan_2.1_vae.safetensors'), ('AudioEncoderLoader', 'audio_encoder_name', 'wav2vec2_large_english_fp16.safetensors')], ['WanSoundImageToVideo'], 'S2V FP8 and audio conditioning weights were found. This is heavy on 16 GB; configure the official audio-driven workflow and benchmark a short utterance.'),

        ('wan14', 'Wan 2.2 T2V A14B FP8', [('UNETLoader', 'unet_name', 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors'), ('UNETLoader', 'unet_name', 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'), ('CLIPLoader', 'clip_name', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'), ('VAELoader', 'vae_name', 'wan_2.1_vae.safetensors')], ['KSamplerAdvanced'], 'Both high-noise and low-noise FP8 models are available. Use the official dual-model T2V template with offloading. Memory and speed are not yet tested.'),

        ('ltxlegacy', 'LTX-Video 0.9.8 distilled 2B', [('CheckpointLoaderSimple', 'ckpt_name', 'ltxv-2b-0.9.8-distilled.safetensors'), ('CLIPLoader', 'clip_name', 't5xxl_fp16.safetensors')], ['LTXVConditioning'], 'Older silent LTX-Video weights are available, including 2B and 13B variants. They do not provide LTX-2.5 audio generation. Start with the 2B official legacy template.')

    ]

    specs.append(('vace', 'Wan VACE 1.3B', [('UNETLoader', 'unet_name', 'wan2.1_vace_1.3B_fp16.safetensors'), ('CLIPLoader', 'clip_name', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'), ('VAELoader', 'vae_name', 'wan_2.1_vae.safetensors')], ['WanVaceToVideo'], 'The existing VACE 1.3B file is registered through an NTFS hard link, without copying weights. Start with short masked video edits.'))
    specs.extend([
        ('edit', 'FLUX.2 Klein 4B FP8', [('UNETLoader','unet_name','flux-2-klein-4b-fp8.safetensors'),('CLIPLoader','clip_name','qwen_3_4b.safetensors'),('VAELoader','vae_name','flux2-vae.safetensors')], ['ReferenceLatent','Flux2Scheduler'], 'Use the distilled four-step image-edit preset with a reference image and a clear edit instruction.'),
        ('flux3', 'FLUX 3 Klein INT8', [('UNETLoader','unet_name','flux3-image-klein-int8-convrot.safetensors'),('CLIPLoader','clip_name','qwen3vl_4b_int8_convrot.safetensors'),('VAELoader','vae_name','flux2-vae.safetensors')], ['EmptyFlux2LatentImage'], 'Use a detailed full-scene caption with distilled INT8 weights. Publisher approval is required to download this model.'),
        ('background', 'BiRefNet Lite', [('LoadRembgByBiRefNetModel','model','General-Lite.safetensors')], ['GetMaskByBiRefNet','JoinImageWithAlpha'], 'Create a foreground mask with BiRefNet Lite and save a PNG with transparency. Inspect fur and fine edges.'),
        ('interpolate', 'RIFE 4.9', [('RIFE VFI','ckpt_name','rife49.pth')], ['GetVideoComponents','CreateVideo','SaveVideo'], 'Double the frame rate of a short approved clip using the compatible RIFE 4.9 checkpoint.'),
        ('motion', 'Wan Animate 2 distilled INT8', [('UNETLoader','unet_name','wan_animate_2_distill_int8_convrot.safetensors'),('CLIPLoader','clip_name','umt5_xxl_fp8_e4m3fn_scaled.safetensors'),('CLIPVisionLoader','clip_name','CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'),('VAELoader','vae_name','wan_2.1_vae.safetensors')], ['WanAnimate2ToVideo','WanAnimate2Cache'], 'Transfer a short driving performance to a reference character. Use CPU activation caching on the 16 GB GPU.'),
        ('ltx', 'LTX-2.5 distilled INT8', [('UNETLoader','unet_name','ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors'),('CLIPLoader','clip_name','gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors'),('VAELoader','vae_name','ltx-2.5-video-vae-bf16.safetensors'),('VAELoader','vae_name','ltx-2.5-audio-vae-bf16.safetensors')], ['LTXVDualCFGGuider','LTXVAudioVAEDecode'], 'Generate video and audio together with the distilled single-pass smoke preset. CPU offloading is essential; longer clips need separate testing.')
    ])
    result = {}

    for ident, model, weights, nodes, guide in specs:

        found = [name for loader, field, name in weights if listed(loader, field, name)]

        missing = [name for loader, field, name in weights if not listed(loader, field, name)]

        missing_nodes = [name for name in nodes if name not in info]

        if ident == 'reference':

            adapter = LIBRARY / 'ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors'

            (found if adapter.is_file() else missing).append(adapter.name)

        if ident == 'interpolate' and not (WORKSPACE / 'ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/rife49.pth').is_file():
            missing.append('RIFE checkpoint not downloaded')
        ready = not missing and not missing_nodes

        result[ident] = {'model': model, 'status': 'available' if ready else 'partial', 'guide': guide, 'needs': 'Found: ' + ', '.join(found) + '. ' + ('Missing or not registered: ' + ', '.join(missing + missing_nodes) + '.' if not ready else 'Required model selections and core nodes are registered. Configure the workflow in ComfyUI; not render-tested.'), 'fit': ('Heavy - offloading - untested' if ident in ('talk', 'wan14', 'motion', 'ltx') else '16 GB candidate - untested') if ready else 'Weights found · setup incomplete'}

    vace = [p.name for p in (LIBRARY / 'vae').glob('*vace*.safetensors')]

    result['image']['url'] = 'https://comfyanonymous.github.io/ComfyUI_examples/flux/'

    if result['vace']['status'] != 'available':
        result['vace'] = {'status': 'partial', 'needs': 'Found in the shared VAE folder: ' + ', '.join(vace) + '. These diffusion weights are misplaced and are not exposed as diffusion-model selections. No files were moved.', 'fit': 'Weights found · path correction needed'}

    report_file = RUNTIME / 'render-test-results.json'
    if report_file.is_file():
        report = json.loads(report_file.read_text(encoding='utf-8')).get('workflows', {})
        for ident, entry in result.items():
            if entry['status'] == 'available' and report.get(ident, {}).get('status') == 'passed':
                entry['fit'] = 'Small GPU render passed'
                entry['needs'] = entry['needs'].replace('Configure the workflow in ComfyUI; not render-tested.', 'Download the tested sample preset. Larger jobs and visual quality need separate checks.')
                for phrase in ('No local render test yet.', 'GPU performance has not been benchmarked here.', 'Memory and speed are not yet tested.', 'no local render test yet.'):
                    entry['guide'] = entry['guide'].replace(phrase, 'A small sample has passed; larger jobs need testing.')
    return {'workflows': result, 'warnings': ['Shared checkpoint flux1-dev-fp8.safetensors failed the size check; use the diffusion_models copy selected above.', 'depthfm-v1_fp16.safetensors failed the header check. Do not select it.', 'Folder registration also lists misplaced files; availability checks do not recommend them.'], 'library': str(LIBRARY)}


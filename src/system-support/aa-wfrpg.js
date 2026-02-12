import { trafficCop } from "../router/traffic-cop.js";
import AAHandler from "../system-handlers/workflow-data.js";
import { getRequiredData } from "./getRequiredData.js";
import { AnimationState } from "../AnimationState.js";
import { DataSanitizer } from "../aa-classes/DataSanitizer.js";
import { debug } from "../constants/constants.js";

export function systemHooks() {
   Hooks.on("updateActiveEffect", (data, toggle, _, userId) => {
      if (game.settings.get("autoanimations", "disableAEAnimations")) {
         return;
      }
      if (game.user.id !== userId) { return; }
      toggleActiveEffectsWfrp(data, toggle)
   });

   Hooks.on("createActiveEffect", (effect, _, userId) => {
      if (game.settings.get("autoanimations", "disableAEAnimations")) {
         return;
      }
      if (game.user.id !== userId) { return; }
      createActiveEffectsWfrp(effect)
   });

   Hooks.on("deleteActiveEffect", (effect, _, userId) => {
      if (game.settings.get("autoanimations", "disableAEAnimations")) {
         return;
      }
      if (game.user.id !== userId) { return; }
      deleteActiveEffectsWfrp(effect)
   });

   Hooks.on("wfrp4e:rollWeaponTest", async (data, info) => {
      if (game.user.id !== info.user) { return; }
      let compiledData = await getRequiredData({
         item: data.weapon,
         targets: compileTargets(data.context?.targets),
         tokenId: info.speaker?.token,
         actorId: info.speaker?.actor,
         workflow: data
      });
      compiledData.targets = data.context?.targets ? Array.from(data.context?.targets).map(token => canvas.tokens.get(token.token)) : [];
      const handler = await AAHandler.make(data);
      await trafficCop(handler);
   });

   Hooks.on("wfrp4e:rollPrayerTest", async (data, info) => {
      if (data.result.outcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return; }
      let compiledData = await getRequiredData({
         item: data.prayer,
         targets: compileTargets(data.context?.targets),
         tokenId: info.speaker?.token,
         actorId: info.speaker?.actor,
         workflow: data
      });
      const handler = await AAHandler.make(data);
      await trafficCop(handler);
   });

   Hooks.on("wfrp4e:rollCastTest", async (data, info) => {
      if (game.user.id !== info.user) { return; }
      if (data.result.castOutcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return; }
      let compiledData = await getRequiredData({
         item: data.spell,
         targets: compileTargets(data.context?.targets),
         tokenId: info.speaker?.token,
         actorId: info.speaker?.actor,
         workflow: data
      });
      const handler = await AAHandler.make(data);
      await trafficCop(handler);
   });

   Hooks.on("wfrp4e:applyDamage", async (scriptArgs) => {
      if (!game.user.isGM) { return; }
      if (scriptArgs.opposedTest.attackerTest.result.castOutcome != "success" || !scriptArgs.opposedTest.attackerTest.spell?.system?.magicMissile?.value) { return; }
      let compiledData = await getRequiredData({
         item: scriptArgs.opposedTest.attackerTest.spell,
         targets: game.canvas.tokens.placeables.filter(x => x.actor?.id == scriptArgs.opposedTest.defenderTest.data.context.speaker.actor),
         tokenId: game.canvas.tokens.placeables.filter(x => x.actor?.id == scriptArgs.opposedTest.attackerTest.data.context.speaker.actor)?.id,
         actorId: scriptArgs.attacker.id,
         workflow: scriptArgs.opposedTest.attackerTest
      });
      const handler = await AAHandler.make(compiledData);
      await trafficCop(handler);
   });

   Hooks.on("wfrp4e:rollTraitTest", async (data, info) => {
      if (game.user.id !== info.user) { return; }
      let compiledData = await getRequiredData({
         item: data.trait,
         targets: compileTargets(data.context?.targets),
         tokenId: info.speaker?.token,
         actorId: info.speaker?.actor,
         workflow: data
      });
      const handler = await AAHandler.make(compiledData);
      await trafficCop(handler);
   });

   Hooks.on("wfrp4e:rollTest", async (data, info) => {
      if (game.user.id !== info.user) { return; }
      if (data.result.outcome != "success" && game.settings.get('autoanimations', 'castOnlyOnSuccess')) { return; }
      if (!data.skill) { return; }
      let compiledData = await getRequiredData({
         item: data.skill,
         targets: compileTargets(data.context?.targets),
         tokenId: info.speaker?.token,
         actorId: info.speaker?.actor,
         workflow: data
      });
      const handler = await AAHandler.make(compiledData);
      await trafficCop(handler);
   });

   Hooks.on("createMeasuredTemplate", async (template, data, userId) => {
      if (userId !== game.user.id) { return; };
      if (template?.flags?.wfrp4e?.itemuuid) {
         const uuid = template.flags.wfrp4e.itemuuid;
         const input = await getRequiredData({ itemUuid: uuid, templateData: template, workflow: template, isTemplate: true });
         if (!input.item) {
            return;
         }
         const handler = await AAHandler.make(input);
         await trafficCop(handler);
      } else if (template?.flags?.wfrp4e?.effectData) {
         const item = await fromUuid(template.flags.wfrp4e.effectData.system.sourceData.item);
         const effect = item.effects.get(template.flags.wfrp4e.effectData._id);
         const input = await getRequiredData({ itemUuid: effect.parent.uuid, templateData: template, workflow: template, isTemplate: true });
         if (!input.item) {
            return;
         }
         const handler = await AAHandler.make(input);
         if (handler.templateData?.flags?.wfrp4e?.effectData && handler.animationData?.primary?.options) {
            handler.templateData.hidden = true;
         }
         await trafficCop(handler);
         const templateObj = game.scenes.current.templates.get(template.id);
         await templateObj.update({ hidden: true });
      } else if (template?.flags?.wfrp4e?.auraToken) {
         const effectUuid = template.flags.wfrp4e.effectUuid;
         const effect = await fromUuid(effectUuid);
         const input = await getRequiredData({ itemUuid: effect.parent.uuid, templateData: template, workflow: template, isTemplate: true });
         if (!input.item) {
            return;
         }
         const handler = await AAHandler.make(input);
         await trafficCop(handler);
      }
   });

   Hooks.on("AutomatedAnimations-WorkflowStart", onWorkflowStart);
}

function onWorkflowStart(clonedData, animationData) {
   if (clonedData.activeEffect?.constructor.name == "Boolean" && clonedData.activeEffect && animationData) { // item is ActiveEffect
      let effect = clonedData.item;
      if (effect.system.transferData.type == "aura" && effect.flags.autoanimations?.activeEffectType == "aura") {
         let radius = effect.radius;
         animationData.primary.options.size = radius;
      }
      else if (effect.system.transferData.type == "document" && effect.system.transferData.area.aura.transferred && effect.flags.autoanimations?.activeEffectType == "aura") {
         clonedData.stopWorkflow = true;
      }
   }
   else if (clonedData.activeEffect?.constructor.name == "EffectWfrp4e" && clonedData.activeEffect?.system.transferData.type == "aura" && animationData) { // item is item.
      if (clonedData.activeEffect.flags?.autoanimations.activeEffectType == "aura") {
         let effect = clonedData.activeEffect;
         animationData.primary.options.size = effect.radius;
      }
   }
}

async function createActiveEffectsWfrp(effect) {
    if (!AnimationState.enabled) { return; }

    const actor = effect.parent instanceof Item ? effect.parent.actor : effect.parent;
    if (!actor) { return; }
    const aeToken = actor.token ?? actor.getActiveTokens()[0];
    if (!aeToken) {
        debug("Failed to find the Token for the Active Effect")
        return;
    }
    const aeNameField = (effect.name ?? effect.label) + `${aeToken.id}`
    const checkAnim = Sequencer.EffectManager.getEffects({ object: aeToken, name: aeNameField }).length > 0
    if (checkAnim) {
        debug("Animation is already present on the Token, returning.")
        return;
    }

    const data = {
        token: aeToken,
        targets: [aeToken],
        item: effect,
        activeEffect: true,
        tieToDocuments: true,
    }

    let handler = await AAHandler.make(data);
    if (!handler) { return; }
    if (!handler.item || !handler.sourceToken) {
      debug("Failed to find the Item or Source Token", handler)
      return;
    }
    // apply the aura effect only to the owner of aura if transferData is aura. Note, this effect is never active on parent.
    if (handler.animationData?.activeEffectType == 'aura' && effect.system.transferData?.type != "aura") return;

    // apply actual radius from effect to aura
    if (handler.animationData?.activeEffectType == 'aura' && effect.system.transferData?.type == "aura") {
        handler.animationData.primary.options.size = handler.item.radius;
    }
    // for all other cases - do nothing if effect is disabled.
    else if (effect.disabled) {
      return;
    }
    trafficCop(handler);
}

async function deleteActiveEffectsWfrp(effect) {
    const actor = effect.parent instanceof Item ? effect.parent.actor : effect.parent;
    if (!actor) { return; }
    const token = actor.token ?? actor.getActiveTokens()[0];

    const data = {
        token: token,
        targets: [],
        item: effect,
        activeEffect: true,
    };

    const handler = await AAHandler.make(data);
    if (!handler) { return; }

    const flagData = handler.animationData
    const macro = await DataSanitizer.compileMacro(handler, flagData);
    if (macro) {
        if (isNewerVersion(game.version, 11)) {
            new Sequence()
            .macro(macro.name, {args: ["off", handler, macro.args]})
            .play()
        } else {
            if (game.modules.get("advanced-macros")?.active) {
                new Sequence()
                    .macro(macro.name, "off", handler, macro.args)
                    .play()
            } else {
                new Sequence()
                    .macro(macro.name)
                    .play()
            }
        }
    }

   let aaEffects = Sequencer.EffectManager.getEffects({ origin: effect.uuid });
   if (aaEffects.length > 0) {
      // Filters the active Animations to isolate the ones active on the Token
      let currentEffect = aaEffects.filter(i => effect.uuid.includes(i.source?.actor?.id));
      currentEffect = currentEffect.length < 1 ? aaEffects.filter(i => effect.uuid.includes(i.source?.id)) : currentEffect;
      if (currentEffect.length < 0) { return; }

      // Fallback for the Source Token
      if (!handler.sourceToken) {
            handler.sourceToken = currentEffect[0].source;
      }

      // End all Animations on the token with .origin(effect.uuid)
      Sequencer.EffectManager.endEffects({ origin: effect.uuid, object: handler.sourceToken })
   }
}

async function toggleActiveEffectsWfrp(effect) {
   await deleteActiveEffectsWfrp(effect);
   await createActiveEffectsWfrp(effect);
}

function compileTargets(targets) {
   if (!targets) { return []; }
   return Array.from(targets).map(token => canvas.tokens.get(token.token));
}

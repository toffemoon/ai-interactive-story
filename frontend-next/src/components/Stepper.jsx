import React, { useState, Children } from "react";
import { motion } from "motion/react";

import "./Stepper.css";

// React Bits · Stepper(JS+CSS 变体)· 适配沐言:配色由紫黑改暖夜(朱砂/月白/线),
// 步骤指示器内联色一并换;其余动画/逻辑保持原样。
export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = "",
  stepContainerClassName = "",
  contentClassName = "",
  footerClassName = "",
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = "上一步",
  nextButtonText = "下一步",
  completeText = "完成",
  disableStepIndicators = false,
  renderStepIndicator,
  ...rest
}) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [direction, setDirection] = useState(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep) => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  return (
    <div className="mu-stepper" {...rest}>
      <div className={`step-circle-container ${stepCircleContainerClassName}`}>
        <div className={`step-indicator-row ${stepContainerClassName}`}>
          {stepsArray.map((_, index) => {
            const stepNumber = index + 1;
            const isNotLastStep = index < totalSteps - 1;
            return (
              <React.Fragment key={stepNumber}>
                {renderStepIndicator ? (
                  renderStepIndicator({
                    step: stepNumber,
                    currentStep,
                    onStepClick: (clicked) => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    },
                  })
                ) : (
                  <StepIndicator
                    step={stepNumber}
                    disableStepIndicators={disableStepIndicators}
                    currentStep={currentStep}
                    onClickStep={(clicked) => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    }}
                  />
                )}
                {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
              </React.Fragment>
            );
          })}
        </div>

        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={`step-content-default ${contentClassName}`}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {!isCompleted && (
          <div className={`footer-container ${footerClassName}`}>
            <div className={`footer-nav ${currentStep !== 1 ? "spread" : "end"}`}>
              {currentStep !== 1 && (
                <button
                  onClick={handleBack}
                  className={`back-button ${currentStep === 1 ? "inactive" : ""}`}
                  {...backButtonProps}
                >
                  {backButtonText}
                </button>
              )}
              <button onClick={isLastStep ? handleComplete : handleNext} className="next-button" {...nextButtonProps}>
                {isLastStep ? completeText : nextButtonText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 适配修:原版「绝对定位 + 测 offsetHeight + 弹簧动 height + AnimatePresence」在本项目里出现
// 内容塌成 0 高 / 新步不进场 / 旧步堆叠 的怪象。改最稳做法 —— 按 currentStep 做 key,
// 换步即重挂、播一次滑入(enter→center);旧步即时卸载。不测高、不用 AnimatePresence/exit,
// 绝不堆叠或塌陷。代价:无退场滑出动画(进场滑入仍在),换来稳定正确。
function StepContentWrapper({ isCompleted, currentStep, direction, children, className }) {
  if (isCompleted) return null;
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      <motion.div
        key={currentStep}
        custom={direction}
        variants={stepVariants}
        initial="enter"
        animate="center"
        transition={{ duration: 0.35 }}
      >
        {children}
      </motion.div>
    </div>
  );
}

const stepVariants = {
  enter: (dir) => ({
    x: dir >= 0 ? "-100%" : "100%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir) => ({
    x: dir >= 0 ? "50%" : "-50%",
    opacity: 0,
  }),
};

export function Step({ children }) {
  return <div className="step-default">{children}</div>;
}

// 状态色(指示器底色 / 连接线填充)改纯 CSS class 驱动 —— 本版 motion 的 variant/animate 切换
// 在这两处不稳(active 步底色、连接线不更新)。motion 仅保留内容滑入 + 勾的描边(那两处正常)。
function StepIndicator({ step, currentStep, onClickStep, disableStepIndicators }) {
  const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete";

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) onClickStep(step);
  };

  return (
    <div
      onClick={handleClick}
      className="step-indicator"
      style={disableStepIndicators ? { pointerEvents: "none", opacity: 0.5 } : {}}
    >
      <div className={`step-indicator-inner is-${status}`}>
        {status === "complete" ? (
          <CheckIcon className="check-icon" />
        ) : status === "active" ? (
          <div className="active-dot" />
        ) : (
          <span className="step-number">{step}</span>
        )}
      </div>
    </div>
  );
}

function StepConnector({ isComplete }) {
  return (
    <div className="step-connector">
      <div className={`step-connector-inner ${isComplete ? "is-complete" : ""}`} />
    </div>
  );
}

function CheckIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.1, type: "tween", ease: "easeOut", duration: 0.3 }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

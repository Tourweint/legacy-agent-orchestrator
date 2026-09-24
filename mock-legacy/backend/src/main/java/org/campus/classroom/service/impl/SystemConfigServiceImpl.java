package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.entity.SystemConfig;
import org.campus.classroom.enums.CreditLevel;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.SystemConfigMapper;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.vo.SystemConfigVO;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class SystemConfigServiceImpl implements SystemConfigService {
    private static final String RESERVATION_LEVEL_A_MAX_SINGLE_MINUTES = "reservation.level_a_max_single_minutes";
    private static final String RESERVATION_LEVEL_B_MAX_SINGLE_MINUTES = "reservation.level_b_max_single_minutes";
    private static final String RESERVATION_LEVEL_C_MAX_SINGLE_MINUTES = "reservation.level_c_max_single_minutes";
    private static final String RESERVATION_LEVEL_A_DAILY_MAX_MINUTES = "reservation.level_a_daily_max_minutes";
    private static final String RESERVATION_LEVEL_B_DAILY_MAX_MINUTES = "reservation.level_b_daily_max_minutes";
    private static final String RESERVATION_LEVEL_C_DAILY_MAX_MINUTES = "reservation.level_c_daily_max_minutes";
    private static final String ATTENDANCE_CHECK_IN_EARLY_MINUTES = "attendance.check_in_early_minutes";
    private static final String ATTENDANCE_CHECK_IN_GRACE_MINUTES = "attendance.check_in_grace_minutes";
    private static final String CREDIT_CHECK_IN_REWARD = "credit.check_in_reward";
    private static final String CREDIT_NO_SHOW_DEDUCTION = "credit.no_show_deduction";
    private static final String CREDIT_CANCEL_DEDUCTION = "credit.cancel_deduction";
    private static final String CREDIT_DAILY_RECOVERY_SCORE = "credit.daily_recovery_score";
    private static final String CREDIT_SUCCESS_STREAK_REWARD = "credit.success_streak_reward";
    private static final String CREDIT_SUCCESS_STREAK_SIZE = "credit.success_streak_size";
    private static final String CREDIT_MIN_SCORE = "credit.min_score";
    private static final String CREDIT_MAX_SCORE = "credit.max_score";
    private static final String CREDIT_LEVEL_A_MIN_SCORE = "credit.level_a_min_score";
    private static final String CREDIT_LEVEL_B_MIN_SCORE = "credit.level_b_min_score";
    private static final String CREDIT_LEVEL_A_ADVANCE_HOURS = "credit.level_a_advance_hours";
    private static final String CREDIT_LEVEL_B_ADVANCE_HOURS = "credit.level_b_advance_hours";
    private static final String CREDIT_LEVEL_C_ADVANCE_HOURS = "credit.level_c_advance_hours";
    private static final String UI_RESERVATION_START_TIME = "ui.reservation_start_time";
    private static final String UI_RESERVATION_END_TIME = "ui.reservation_end_time";

    private final SystemConfigMapper systemConfigMapper;

    @Override
    public List<SystemConfigVO> listConfigs(String category) {
        return systemConfigMapper.selectList(normalize(category))
                .stream()
                .map(this::toVO)
                .toList();
    }

    @Override
    @Transactional
    public SystemConfigVO updateConfig(String key, String value) {
        SystemConfig config = getConfig(key);
        if (!Integer.valueOf(1).equals(config.getEditable())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "该配置项不允许修改");
        }

        String normalizedValue = normalizeByType(value, config.getValueType());
        int updatedRows = systemConfigMapper.updateValue(key, normalizedValue);
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "配置更新失败，请刷新后重试");
        }
        return toVO(getConfig(key));
    }

    @Override
    public int getMaxSingleReservationMinutes(Integer creditScore) {
        CreditRuleSnapshot creditRules = getCreditRuleSnapshot();
        return switch (resolveCreditLevel(creditScore, creditRules)) {
            case A -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_A_MAX_SINGLE_MINUTES), 360, RESERVATION_LEVEL_A_MAX_SINGLE_MINUTES);
            case B -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_B_MAX_SINGLE_MINUTES), 180, RESERVATION_LEVEL_B_MAX_SINGLE_MINUTES);
            case C -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_C_MAX_SINGLE_MINUTES), 120, RESERVATION_LEVEL_C_MAX_SINGLE_MINUTES);
        };
    }

    @Override
    public int getDailyReservationLimitMinutes(Integer creditScore) {
        CreditRuleSnapshot creditRules = getCreditRuleSnapshot();
        return switch (resolveCreditLevel(creditScore, creditRules)) {
            case A -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_A_DAILY_MAX_MINUTES), 720, RESERVATION_LEVEL_A_DAILY_MAX_MINUTES);
            case B -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_B_DAILY_MAX_MINUTES), 540, RESERVATION_LEVEL_B_DAILY_MAX_MINUTES);
            case C -> getIntValue(creditRules.configMap().get(RESERVATION_LEVEL_C_DAILY_MAX_MINUTES), 480, RESERVATION_LEVEL_C_DAILY_MAX_MINUTES);
        };
    }

    @Override
    public int getCheckInEarlyMinutes() {
        return getIntConfig(ATTENDANCE_CHECK_IN_EARLY_MINUTES, 10);
    }

    @Override
    public int getCheckInGraceMinutes() {
        return getIntConfig(ATTENDANCE_CHECK_IN_GRACE_MINUTES, 15);
    }

    @Override
    public int getCheckInRewardScore() {
        return getIntConfig(CREDIT_CHECK_IN_REWARD, 1);
    }

    @Override
    public int getNoShowDeductionScore() {
        return getIntConfig(CREDIT_NO_SHOW_DEDUCTION, 2);
    }

    @Override
    public int getCancelDeductionScore() {
        return getIntConfig(CREDIT_CANCEL_DEDUCTION, 1);
    }

    @Override
    public int getDailyRecoveryScore() {
        return getIntConfig(CREDIT_DAILY_RECOVERY_SCORE, 1);
    }

    @Override
    public int getSuccessStreakRewardScore() {
        return getIntConfig(CREDIT_SUCCESS_STREAK_REWARD, 1);
    }

    @Override
    public int getSuccessStreakSize() {
        return getIntConfig(CREDIT_SUCCESS_STREAK_SIZE, 3);
    }

    @Override
    public int getCreditMinScore() {
        return getIntConfig(CREDIT_MIN_SCORE, 30);
    }

    @Override
    public int getCreditMaxScore() {
        return getIntConfig(CREDIT_MAX_SCORE, 100);
    }

    @Override
    public int getSeatReservationAdvanceHours(Integer creditScore) {
        CreditRuleSnapshot creditRules = getCreditRuleSnapshot();
        return switch (resolveCreditLevel(creditScore, creditRules)) {
            case A -> getIntValue(creditRules.configMap().get(CREDIT_LEVEL_A_ADVANCE_HOURS), 24, CREDIT_LEVEL_A_ADVANCE_HOURS);
            case B -> getIntValue(creditRules.configMap().get(CREDIT_LEVEL_B_ADVANCE_HOURS), 12, CREDIT_LEVEL_B_ADVANCE_HOURS);
            case C -> getIntValue(creditRules.configMap().get(CREDIT_LEVEL_C_ADVANCE_HOURS), 6, CREDIT_LEVEL_C_ADVANCE_HOURS);
        };
    }

    @Override
    public String getCreditLevelCode(Integer creditScore) {
        return resolveCreditLevel(creditScore, getCreditRuleSnapshot()).getCode();
    }

    @Override
    public LocalTime getReservationStartTime() {
        return getTimeConfig(UI_RESERVATION_START_TIME, LocalTime.of(7, 0));
    }

    @Override
    public LocalTime getReservationEndTime() {
        return getTimeConfig(UI_RESERVATION_END_TIME, LocalTime.of(22, 30));
    }

    private int getIntConfig(String key, int defaultValue) {
        return getIntValue(systemConfigMapper.selectByKey(key), defaultValue, key);
    }

    private CreditRuleSnapshot getCreditRuleSnapshot() {
        Map<String, SystemConfig> configMap = systemConfigMapper.selectByKeys(List.of(
                CREDIT_MIN_SCORE,
                CREDIT_MAX_SCORE,
                CREDIT_LEVEL_A_MIN_SCORE,
                CREDIT_LEVEL_B_MIN_SCORE,
                CREDIT_LEVEL_A_ADVANCE_HOURS,
                CREDIT_LEVEL_B_ADVANCE_HOURS,
                CREDIT_LEVEL_C_ADVANCE_HOURS,
                RESERVATION_LEVEL_A_MAX_SINGLE_MINUTES,
                RESERVATION_LEVEL_B_MAX_SINGLE_MINUTES,
                RESERVATION_LEVEL_C_MAX_SINGLE_MINUTES,
                RESERVATION_LEVEL_A_DAILY_MAX_MINUTES,
                RESERVATION_LEVEL_B_DAILY_MAX_MINUTES,
                RESERVATION_LEVEL_C_DAILY_MAX_MINUTES
        )).stream().collect(Collectors.toMap(SystemConfig::getConfigKey, Function.identity()));

        int minScore = getIntValue(configMap.get(CREDIT_MIN_SCORE), 30, CREDIT_MIN_SCORE);
        int maxScore = getIntValue(configMap.get(CREDIT_MAX_SCORE), 100, CREDIT_MAX_SCORE);
        int levelAMinScore = getIntValue(configMap.get(CREDIT_LEVEL_A_MIN_SCORE), 80, CREDIT_LEVEL_A_MIN_SCORE);
        int levelBMinScore = getIntValue(configMap.get(CREDIT_LEVEL_B_MIN_SCORE), 50, CREDIT_LEVEL_B_MIN_SCORE);
        return new CreditRuleSnapshot(configMap, minScore, maxScore, levelAMinScore, levelBMinScore);
    }

    private CreditLevel resolveCreditLevel(Integer creditScore, CreditRuleSnapshot creditRules) {
        int normalizedScore = normalizeScore(creditScore, creditRules.minScore(), creditRules.maxScore());
        if (normalizedScore >= creditRules.levelAMinScore()) {
            return CreditLevel.A;
        }
        if (normalizedScore >= creditRules.levelBMinScore()) {
            return CreditLevel.B;
        }
        return CreditLevel.C;
    }

    private int normalizeScore(Integer score, int minScore, int maxScore) {
        if (score == null) {
            return maxScore;
        }
        return Math.max(minScore, Math.min(maxScore, score));
    }

    private LocalTime getTimeConfig(String key, LocalTime defaultValue) {
        SystemConfig config = systemConfigMapper.selectByKey(key);
        if (config == null || !StringUtils.hasText(config.getConfigValue())) {
            return defaultValue;
        }
        try {
            return LocalTime.parse(config.getConfigValue().trim());
        } catch (Exception ex) {
            log.warn("[系统配置读取失败] configKey={}, configValue={}, 使用默认值={}",
                    key, config.getConfigValue(), defaultValue);
            return defaultValue;
        }
    }

    private int getIntValue(SystemConfig config, int defaultValue, String key) {
        if (config == null || !StringUtils.hasText(config.getConfigValue())) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(config.getConfigValue().trim());
        } catch (NumberFormatException ex) {
            log.warn("[系统配置读取失败] configKey={}, configValue={}, 使用默认值={}",
                    key, config.getConfigValue(), defaultValue);
            return defaultValue;
        }
    }

    private SystemConfig getConfig(String key) {
        SystemConfig config = systemConfigMapper.selectByKey(key);
        if (config == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "配置项不存在");
        }
        return config;
    }

    private String normalizeByType(String value, String valueType) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "配置值不能为空");
        }
        String trimmed = value.trim();
        String safeType = valueType == null ? "STRING" : valueType.trim().toUpperCase(Locale.ROOT);
        try {
            return switch (safeType) {
                case "INT" -> String.valueOf(Integer.parseInt(trimmed));
                case "BOOLEAN" -> normalizeBoolean(trimmed);
                case "TIME" -> LocalTime.parse(trimmed).toString();
                default -> trimmed;
            };
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "配置值格式不正确");
        }
    }

    private String normalizeBoolean(String value) {
        if ("true".equalsIgnoreCase(value) || "1".equals(value)) {
            return "true";
        }
        if ("false".equalsIgnoreCase(value) || "0".equals(value)) {
            return "false";
        }
        throw new IllegalArgumentException("invalid boolean");
    }

    private String normalize(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private SystemConfigVO toVO(SystemConfig config) {
        SystemConfigVO configVO = new SystemConfigVO();
        BeanUtils.copyProperties(config, configVO);
        return configVO;
    }

    private record CreditRuleSnapshot(
            Map<String, SystemConfig> configMap,
            int minScore,
            int maxScore,
            int levelAMinScore,
            int levelBMinScore
    ) {
    }
}

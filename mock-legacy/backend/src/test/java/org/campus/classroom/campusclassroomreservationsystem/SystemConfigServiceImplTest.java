package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.entity.SystemConfig;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.SystemConfigMapper;
import org.campus.classroom.service.impl.SystemConfigServiceImpl;
import org.campus.classroom.vo.SystemConfigVO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SystemConfigServiceImplTest {

    @Mock
    private SystemConfigMapper systemConfigMapper;

    @InjectMocks
    private SystemConfigServiceImpl systemConfigService;

    // 验证系统配置服务会根据信用分正确解析不同等级的预约时长限制。
    @Test
    void getMaxSingleReservationMinutes_shouldResolveByCreditLevel() {
        when(systemConfigMapper.selectByKeys(org.mockito.ArgumentMatchers.anyList())).thenReturn(List.of(
                intConfig("credit.min_score", "30"),
                intConfig("credit.max_score", "100"),
                intConfig("credit.level_a_min_score", "80"),
                intConfig("credit.level_b_min_score", "50"),
                intConfig("credit.level_a_advance_hours", "24"),
                intConfig("credit.level_b_advance_hours", "12"),
                intConfig("credit.level_c_advance_hours", "6"),
                intConfig("reservation.level_a_max_single_minutes", "360"),
                intConfig("reservation.level_b_max_single_minutes", "180"),
                intConfig("reservation.level_c_max_single_minutes", "120"),
                intConfig("reservation.level_a_daily_max_minutes", "720"),
                intConfig("reservation.level_b_daily_max_minutes", "540"),
                intConfig("reservation.level_c_daily_max_minutes", "480")
        ));

        assertEquals(360, systemConfigService.getMaxSingleReservationMinutes(95));
        assertEquals(180, systemConfigService.getMaxSingleReservationMinutes(60));
        assertEquals(120, systemConfigService.getMaxSingleReservationMinutes(40));
        assertEquals(360, systemConfigService.getMaxSingleReservationMinutes(null));
    }

    // 验证配置更新时会按值类型做标准化处理后再落库。
    @Test
    void updateConfig_shouldNormalizeValueByType() {
        SystemConfig config = new SystemConfig();
        config.setConfigKey("attendance.check_in_early_minutes");
        config.setValueType("INT");
        config.setEditable(1);
        config.setConfigValue("10");

        SystemConfig updated = new SystemConfig();
        updated.setConfigKey("attendance.check_in_early_minutes");
        updated.setValueType("INT");
        updated.setEditable(1);
        updated.setConfigValue("15");

        when(systemConfigMapper.selectByKey("attendance.check_in_early_minutes"))
                .thenReturn(config, updated);
        when(systemConfigMapper.updateValue("attendance.check_in_early_minutes", "15")).thenReturn(1);

        SystemConfigVO result = systemConfigService.updateConfig("attendance.check_in_early_minutes", " 15 ");

        assertEquals("15", result.getConfigValue());
        verify(systemConfigMapper).updateValue("attendance.check_in_early_minutes", "15");
    }

    // 验证不可编辑的系统配置项不能被后台更新。
    @Test
    void updateConfig_shouldThrowWhenConfigIsNotEditable() {
        SystemConfig config = new SystemConfig();
        config.setConfigKey("credit.min_score");
        config.setValueType("INT");
        config.setEditable(0);

        when(systemConfigMapper.selectByKey("credit.min_score")).thenReturn(config);

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> systemConfigService.updateConfig("credit.min_score", "40")
        );

        assertEquals(ResultCode.FORBIDDEN, exception.getResultCode());
    }

    // 验证时间配置格式非法时会回退到默认值而不是抛出异常。
    @Test
    void getReservationStartTime_shouldFallbackToDefaultWhenConfigIsInvalid() {
        SystemConfig config = new SystemConfig();
        config.setConfigKey("ui.reservation_start_time");
        config.setConfigValue("not-a-time");

        when(systemConfigMapper.selectByKey("ui.reservation_start_time")).thenReturn(config);

        assertEquals(LocalTime.of(7, 0), systemConfigService.getReservationStartTime());
    }

    private SystemConfig intConfig(String key, String value) {
        SystemConfig config = new SystemConfig();
        config.setConfigKey(key);
        config.setConfigValue(value);
        config.setValueType("INT");
        config.setEditable(1);
        return config;
    }
}
